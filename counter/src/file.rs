use crate::model::{Classification, Counts, LanguageCounts};
use crate::rules::{excluded, validate_path};
use std::collections::BTreeMap;

pub(crate) const MAX_FILE: usize = 8 * 1024 * 1024;
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

pub(crate) fn decode(bytes: &[u8]) -> (Vec<u8>, bool) {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let encoding = if bytes[0] == 0xff {
            encoding_rs::UTF_16LE
        } else {
            encoding_rs::UTF_16BE
        };
        let (decoded, _, errors) = encoding.decode(&bytes[2..]);
        return (decoded.as_bytes().to_vec(), errors);
    }
    let text = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        &bytes[3..]
    } else {
        bytes
    };
    let decoded = String::from_utf8_lossy(text);
    let errors = matches!(decoded, std::borrow::Cow::Owned(_));
    (decoded.as_bytes().to_vec(), errors)
}

pub(crate) fn valid_notebook(bytes: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return false;
    };
    let Some(cells) = value.get("cells").and_then(|x| x.as_array()) else {
        return false;
    };
    let Some(metadata) = value.get("metadata") else {
        return false;
    };
    if metadata.get("kernelspec").is_none() || metadata.get("language_info").is_none() {
        return false;
    }
    cells.iter().all(|cell| {
        matches!(
            cell.get("cell_type").and_then(|x| x.as_str()),
            Some("code" | "markdown")
        ) && cell
            .get("source")
            .and_then(|x| x.as_array())
            .is_some_and(|source| source.iter().all(|line| line.is_string()))
    })
}

pub(crate) fn add_stats(
    rows: &mut BTreeMap<String, LanguageCounts>,
    kind: LanguageType,
    stats: &CodeStats,
    physical: bool,
    inaccurate: &mut bool,
) -> Result<(), String> {
    let name = kind.to_string();
    let row = rows.entry(name.clone()).or_insert_with(|| LanguageCounts {
        language: name,
        files: 0,
        counts: Counts::empty(),
    });
    if physical {
        row.files = row.files.checked_add(1).ok_or("counter overflow")?;
    }
    if kind == LanguageType::Jupyter {
        let mut own = stats.clone();
        for child in stats.blobs.values() {
            for (count, removed) in [
                (&mut own.code, child.code),
                (&mut own.comments, child.comments),
                (&mut own.blanks, child.blanks),
            ] {
                *inaccurate |= *count < removed;
                *count = count.saturating_sub(removed);
            }
        }
        row.counts.add(&own)?;
    } else {
        row.counts.add(stats)?;
    }
    for (child, value) in &stats.blobs {
        add_stats(rows, *child, value, false, inaccurate)?;
    }
    Ok(())
}

pub(crate) fn classify_path(
    path: &str,
    prefix: &[u8],
    exclusions: &[String],
) -> Result<Classification, String> {
    validate_path(path)?;
    if prefix.len() > 128 {
        return Err("prefix exceeds byte limit".into());
    }
    if excluded(path, exclusions) {
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
    exclusions: &[String],
) -> Result<Classification, String> {
    let classification = classify_path(path, &bytes[..bytes.len().min(128)], exclusions)?;
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

pub(crate) struct FileAnalysis {
    pub(crate) rows: BTreeMap<String, LanguageCounts>,
    pub(crate) inaccurate: bool,
}

pub(crate) fn analyze_counted(path: &str, bytes: &[u8]) -> Result<FileAnalysis, String> {
    let kind = language(path, &bytes[..bytes.len().min(128)]).ok_or("language detection failed")?;
    let (decoded, mut inaccurate) = decode(bytes);
    let stats = kind.parse_from_slice(&decoded, &Config::default());
    let invalid_notebook = kind == LanguageType::Jupyter && !valid_notebook(&decoded);
    let mut file_rows = BTreeMap::new();
    add_stats(&mut file_rows, kind, &stats, true, &mut inaccurate)?;
    if kind != LanguageType::Jupyter {
        let physical = decoded.iter().filter(|b| **b == b'\n').count() as u64
            + u64::from(!decoded.is_empty() && !decoded.ends_with(b"\n"));
        let attributed = file_rows
            .values()
            .try_fold(0u64, |sum, row: &LanguageCounts| {
                sum.checked_add(row.counts.lines).ok_or("counter overflow")
            })?;
        if attributed > physical {
            let primary = file_rows
                .get_mut(&kind.to_string())
                .ok_or("primary language missing")?;
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
    }
    Ok(FileAnalysis {
        rows: file_rows,
        inaccurate: inaccurate || invalid_notebook,
    })
}
