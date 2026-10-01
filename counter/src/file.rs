use crate::model::{Classification, Counts, LanguageCounts};
use crate::rules::{Rules, validate_path};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::str::FromStr;

pub(crate) const MAX_FILE: usize = 8 * 1024 * 1024;
pub(crate) const MAX_OTHER_EXTENSIONS: usize = 100;
use tokei::{CodeStats, Config, LanguageType};

pub(crate) fn language(path: &str, prefix: &[u8]) -> Option<LanguageType> {
    let name = path.rsplit('/').next()?;
    if (name.contains('.')
        || matches!(
            name,
            "Dockerfile" | "Makefile" | "CMakeLists.txt" | "Gemfile" | "Rakefile" | "Justfile"
        ))
        && let Some(found) = LanguageType::from_path(path, &Config::default())
    {
        return Some(found);
    }
    for (kind, _) in LanguageType::list() {
        if kind
            .shebangs()
            .iter()
            .any(|s| prefix.starts_with(s.as_bytes()))
        {
            return Some(*kind);
        }
    }
    env_shebang(prefix).or_else(|| text_name(name))
}

fn text_name(name: &str) -> Option<LanguageType> {
    const NAMES: &[&str] = &[
        "AUTHORS",
        "CHANGELOG",
        "CHANGES",
        "CONTRIBUTORS",
        "COPYING",
        "HISTORY",
        "LICENCE",
        "LICENSE",
        "NEWS",
        "NOTICE",
        "README",
        "VERSION",
    ];
    let upper = name.to_ascii_uppercase();
    (!name.contains('.')
        && (NAMES.contains(&upper.as_str())
            || upper.starts_with("LICENSE-")
            || upper.starts_with("LICENCE-")))
    .then_some(LanguageType::Text)
}

fn env_shebang(prefix: &[u8]) -> Option<LanguageType> {
    let first = prefix.split(|b| *b == b'\n').next()?;
    let line = std::str::from_utf8(first).ok()?;
    let command = line
        .strip_prefix("#!/usr/bin/env ")?
        .split_whitespace()
        .next()?;
    let command = command.trim_start_matches("-S ");
    match command {
        "python" | "python3" => Some(LanguageType::Python),
        "node" => Some(LanguageType::JavaScript),
        "bash" => Some(LanguageType::Bash),
        "ruby" => Some(LanguageType::Ruby),
        "perl" => Some(LanguageType::Perl),
        _ => None,
    }
}

pub(crate) fn decode(bytes: &[u8]) -> Option<Cow<'_, [u8]>> {
    let encoding = if bytes.starts_with(&[0xff, 0xfe]) {
        encoding_rs::UTF_16LE
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        encoding_rs::UTF_16BE
    } else {
        return Some(Cow::Borrowed(
            bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes),
        ));
    };
    encoding
        .decode_without_bom_handling_and_without_replacement(&bytes[2..])
        .map(|text| Cow::Owned(text.into_owned().into_bytes()))
}

#[derive(Deserialize)]
struct Notebook {
    cells: Vec<Cell>,
    #[serde(default)]
    metadata: serde_json::Value,
}

#[derive(Deserialize)]
struct Cell {
    cell_type: String,
    source: Source,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Source {
    Text(String),
    Lines(Vec<String>),
}

fn notebook_language(metadata: &serde_json::Value) -> LanguageType {
    metadata
        .get("kernelspec")
        .and_then(|x| x.get("language"))
        .and_then(|x| x.as_str())
        .and_then(|x| LanguageType::from_str(x).ok())
        .or_else(|| {
            metadata
                .get("language_info")
                .and_then(|x| x.get("file_extension"))
                .and_then(|x| x.as_str())
                .and_then(|x| LanguageType::from_file_extension(x.trim_start_matches('.')))
        })
        .unwrap_or(LanguageType::Python)
}

fn row(rows: &mut BTreeMap<String, LanguageCounts>, kind: LanguageType) -> &mut LanguageCounts {
    let name = kind.to_string();
    rows.entry(name.clone()).or_insert_with(|| LanguageCounts {
        language: name,
        files: 0,
        counts: Counts::empty(),
    })
}

fn add_stats(
    rows: &mut BTreeMap<String, LanguageCounts>,
    kind: LanguageType,
    stats: &CodeStats,
) -> Result<(), String> {
    row(rows, kind).counts.add(stats)?;
    for (child, value) in &stats.blobs {
        add_stats(rows, *child, value)?;
    }
    Ok(())
}

pub(crate) fn merge_rows(
    rows: &mut BTreeMap<String, LanguageCounts>,
    other: BTreeMap<String, LanguageCounts>,
) -> Result<(), String> {
    for (name, other) in other {
        let aggregate = rows.entry(name.clone()).or_insert_with(|| LanguageCounts {
            language: name,
            files: 0,
            counts: Counts::empty(),
        });
        aggregate.files = aggregate
            .files
            .checked_add(other.files)
            .ok_or("counter overflow")?;
        aggregate.counts.code = aggregate
            .counts
            .code
            .checked_add(other.counts.code)
            .ok_or("counter overflow")?;
        aggregate.counts.comments = aggregate
            .counts
            .comments
            .checked_add(other.counts.comments)
            .ok_or("counter overflow")?;
        aggregate.counts.blanks = aggregate
            .counts
            .blanks
            .checked_add(other.counts.blanks)
            .ok_or("counter overflow")?;
        aggregate.counts.lines = aggregate
            .counts
            .code
            .checked_add(aggregate.counts.comments)
            .and_then(|n| n.checked_add(aggregate.counts.blanks))
            .ok_or("counter overflow")?;
    }
    Ok(())
}

pub(crate) fn physical_lines(text: &[u8]) -> u64 {
    text.iter().filter(|b| **b == b'\n').count() as u64
        + u64::from(!text.is_empty() && !text.ends_with(b"\n"))
}

pub(crate) fn other_extension(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    let extension = name
        .rsplit_once('.')
        .map(|(_, x)| x.to_lowercase())
        .unwrap_or_default();
    if (1..=16).contains(&extension.chars().count())
        && extension
            .chars()
            .all(|c| c > ' ' && !('\u{7f}'..='\u{9f}').contains(&c))
    {
        format!(".{extension}")
    } else {
        String::new()
    }
}

fn add_text(
    rows: &mut BTreeMap<String, LanguageCounts>,
    kind: LanguageType,
    text: &[u8],
) -> Result<(), String> {
    let stats = kind.parse_from_slice(text, &Config::default());
    let mut text_rows = BTreeMap::new();
    add_stats(&mut text_rows, kind, &stats)?;
    let physical = physical_lines(text);
    let attributed = text_rows
        .values()
        .try_fold(0u64, |sum, row: &LanguageCounts| {
            sum.checked_add(row.counts.lines).ok_or("counter overflow")
        })?;
    if attributed > physical {
        let primary = row(&mut text_rows, kind);
        let mut excess = attributed - physical;
        for count in [
            &mut primary.counts.code,
            &mut primary.counts.comments,
            &mut primary.counts.blanks,
        ] {
            let removed = (*count).min(excess);
            *count -= removed;
            excess -= removed;
        }
        if excess != 0 {
            return Err("embedded line attribution failed".into());
        }
        primary.counts.lines =
            primary.counts.code + primary.counts.comments + primary.counts.blanks;
    }
    merge_rows(rows, text_rows)
}

pub(crate) fn classify_path(
    path: &str,
    prefix: &[u8],
    rules: &Rules,
) -> Result<Classification, String> {
    validate_path(path)?;
    if prefix.len() > 128 {
        return Err("prefix exceeds byte limit".into());
    }
    if rules.excludes(path) {
        return Ok(Classification {
            kind: "excluded_by_rule",
            language: None,
        });
    }
    if prefix.starts_with(&[0xff, 0xfe]) || prefix.starts_with(&[0xfe, 0xff]) {
        return Ok(match language(path, &[]) {
            Some(x) => Classification {
                kind: "counted",
                language: Some(x.to_string()),
            },
            None => Classification {
                kind: "unsupported_language",
                language: None,
            },
        });
    }
    if prefix.contains(&0) {
        return Ok(Classification {
            kind: "binary_content",
            language: None,
        });
    }
    Ok(match language(path, prefix) {
        Some(x) => Classification {
            kind: "counted",
            language: Some(x.to_string()),
        },
        None => Classification {
            kind: "unsupported_language",
            language: None,
        },
    })
}

pub(crate) fn classify_file(
    path: &str,
    bytes: &[u8],
    rules: &Rules,
) -> Result<Classification, String> {
    let classification = classify_path(path, &bytes[..bytes.len().min(128)], rules)?;
    let classification = if classification.kind == "counted" && bytes.len() > MAX_FILE {
        Classification {
            kind: "oversized_source",
            language: None,
        }
    } else if classification.kind == "counted"
        && !bytes.starts_with(&[0xff, 0xfe])
        && !bytes.starts_with(&[0xfe, 0xff])
        && bytes.contains(&0)
    {
        Classification {
            kind: "binary_content",
            language: None,
        }
    } else {
        classification
    };
    Ok(classification)
}

pub(crate) enum FileAnalysis {
    Counted(BTreeMap<String, LanguageCounts>),
    Skipped(&'static str),
}

pub(crate) fn analyze_counted(path: &str, bytes: &[u8]) -> Result<FileAnalysis, String> {
    let kind = language(path, &bytes[..bytes.len().min(128)]).ok_or("language detection failed")?;
    let Some(text) = decode(bytes) else {
        return Ok(FileAnalysis::Skipped("binary_content"));
    };
    let mut rows = BTreeMap::new();
    if kind == LanguageType::Jupyter {
        let Ok(notebook) = serde_json::from_slice::<Notebook>(&text) else {
            return Ok(FileAnalysis::Skipped("unsupported_notebook"));
        };
        row(&mut rows, kind).files = 1;
        let language = notebook_language(&notebook.metadata);
        for cell in notebook.cells {
            let kind = match cell.cell_type.as_str() {
                "code" => language,
                "markdown" => LanguageType::Markdown,
                _ => continue,
            };
            let source = match cell.source {
                Source::Text(x) => x,
                Source::Lines(x) => x.concat(),
            };
            add_text(&mut rows, kind, source.as_bytes())?;
        }
    } else {
        add_text(&mut rows, kind, &text)?;
        row(&mut rows, kind).files = 1;
    }
    Ok(FileAnalysis::Counted(rows))
}
