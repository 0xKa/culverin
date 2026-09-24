use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tokei::{CodeStats, Config, LanguageType};
use wasm_bindgen::prelude::*;

const MAX_PATH: usize = 4096;
const MAX_FILE: usize = 8 * 1024 * 1024;
const RULES_VERSION: &str = "1";
const COVERAGE_VERSION: &str = "1";
const WRAPPER_VERSION: &str = "1";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rules {
    pub repository_id: String,
    pub commit_sha: String,
    #[serde(default)]
    pub exclusions: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub lines: u64,
    pub code: u64,
    pub comments: u64,
    pub blanks: u64,
}

impl Counts {
    fn empty() -> Self {
        Self {
            lines: 0,
            code: 0,
            comments: 0,
            blanks: 0,
        }
    }
    fn add(&mut self, stats: &CodeStats) -> Result<(), String> {
        self.code = self
            .code
            .checked_add(stats.code as u64)
            .ok_or("counter overflow")?;
        self.comments = self
            .comments
            .checked_add(stats.comments as u64)
            .ok_or("counter overflow")?;
        self.blanks = self
            .blanks
            .checked_add(stats.blanks as u64)
            .ok_or("counter overflow")?;
        self.lines = self
            .code
            .checked_add(self.comments)
            .and_then(|n| n.checked_add(self.blanks))
            .ok_or("counter overflow")?;
        for n in [self.lines, self.code, self.comments, self.blanks] {
            if n > 9_007_199_254_740_991 {
                return Err("counter overflow".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageCounts {
    pub language: String,
    pub files: u64,
    #[serde(flatten)]
    pub counts: Counts,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub regular_files: u64,
    pub counted_files: u64,
    pub analyzed_bytes: u64,
    pub skipped_files: u64,
    pub skipped_by_reason: BTreeMap<String, u64>,
    pub complete: bool,
    pub incomplete_reasons: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub name: &'static str,
    pub version: &'static str,
    pub wrapper_version: &'static str,
    pub rules_profile: &'static str,
    pub rules_version: &'static str,
    pub rules_hash: String,
    pub coverage_policy_version: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub schema_version: u8,
    pub repository: BTreeMap<String, String>,
    pub revision: BTreeMap<String, String>,
    pub engine: Engine,
    pub totals: Totals,
    pub languages: Vec<LanguageCounts>,
    pub coverage: Coverage,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub files: u64,
    #[serde(flatten)]
    pub counts: Counts,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub kind: &'static str,
    pub language: Option<String>,
}

pub struct CounterAnalyzer {
    rules: Rules,
    hash: String,
    languages: BTreeMap<String, LanguageCounts>,
    coverage: Coverage,
    inaccurate: bool,
}

fn excluded(path: &str, custom: &[String]) -> bool {
    const DIRS: &[&str] = &[
        ".git",
        ".cache",
        ".next",
        ".nuxt",
        ".output",
        ".parcel-cache",
        ".venv",
        "bower_components",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "out",
        "target",
        "third-party",
        "third_party",
        "vendor",
        "venv",
    ];
    const FILES: &[&str] = &[
        "bun.lock",
        "Cargo.lock",
        "Gemfile.lock",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "composer.lock",
        "poetry.lock",
        "Pipfile.lock",
        "go.sum",
    ];
    let name = path.rsplit('/').next().unwrap_or(path);
    path.split('/').any(|part| DIRS.contains(&part))
        || FILES.contains(&name)
        || name.ends_with(".map")
        || name.ends_with(".min.js")
        || name.ends_with(".min.css")
        || custom
            .iter()
            .any(|rule| path == rule || path.starts_with(&format!("{rule}/")))
}

fn language(path: &str, prefix: &[u8]) -> Option<LanguageType> {
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

fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > MAX_PATH
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err("invalid path".into());
    }
    Ok(())
}

fn decode(bytes: &[u8]) -> (Vec<u8>, bool) {
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

fn valid_notebook(bytes: &[u8]) -> bool {
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

fn add_stats(
    rows: &mut BTreeMap<String, LanguageCounts>,
    kind: LanguageType,
    stats: &CodeStats,
    physical: bool,
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
    if matches!(
        kind,
        LanguageType::Html | LanguageType::Vue | LanguageType::Svelte | LanguageType::Jupyter
    ) {
        let mut own = stats.clone();
        for child in stats.blobs.values() {
            own.code = own
                .code
                .checked_sub(child.code)
                .ok_or("embedded count underflow")?;
            own.comments = own
                .comments
                .checked_sub(child.comments)
                .ok_or("embedded count underflow")?;
            own.blanks = own
                .blanks
                .checked_sub(child.blanks)
                .ok_or("embedded count underflow")?;
        }
        row.counts.add(&own)?;
    } else {
        row.counts.add(stats)?;
    }
    for (child, value) in &stats.blobs {
        add_stats(rows, *child, value, false)?;
    }
    Ok(())
}

impl CounterAnalyzer {
    pub fn new(mut rules: Rules) -> Result<Self, String> {
        if rules.repository_id.is_empty()
            || !rules.repository_id.bytes().all(|b| b.is_ascii_digit())
            || (rules.repository_id.len() > 1 && rules.repository_id.starts_with('0'))
        {
            return Err("invalid repository id".into());
        }
        if ![40, 64].contains(&rules.commit_sha.len())
            || !rules
                .commit_sha
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("invalid commit sha".into());
        }
        if rules.exclusions.len() > 64
            || rules.exclusions.iter().any(|x| x.len() > 256)
            || rules.exclusions.iter().map(String::len).sum::<usize>() > 4096
        {
            return Err("invalid exclusions".into());
        }
        for exclusion in &rules.exclusions {
            validate_path(exclusion)?;
            if exclusion.contains('*') || exclusion.contains('?') {
                return Err("invalid exclusions".into());
            }
        }
        rules.exclusions.sort();
        rules.exclusions.dedup();
        let canonical = serde_json::to_vec(&("source-v1", RULES_VERSION, &rules.exclusions))
            .map_err(|e| e.to_string())?;
        let mut hash = String::with_capacity(64);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in Sha256::digest(canonical) {
            hash.push(char::from(HEX[(byte >> 4) as usize]));
            hash.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
        let skipped_by_reason = [
            "excluded_by_rule",
            "unsupported_language",
            "binary_content",
            "oversized_source",
        ]
        .into_iter()
        .map(|s| (s.to_owned(), 0))
        .collect();
        Ok(Self {
            rules,
            hash,
            languages: BTreeMap::new(),
            coverage: Coverage {
                regular_files: 0,
                counted_files: 0,
                analyzed_bytes: 0,
                skipped_files: 0,
                skipped_by_reason,
                complete: true,
                incomplete_reasons: vec![],
            },
            inaccurate: false,
        })
    }
    pub fn classify_path(&self, path: &str, prefix: &[u8]) -> Result<Classification, String> {
        validate_path(path)?;
        if prefix.len() > 128 {
            return Err("prefix exceeds byte limit".into());
        }
        if excluded(path, &self.rules.exclusions) {
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
    pub fn add_file(&mut self, path: &str, bytes: &[u8]) -> Result<Classification, String> {
        validate_path(path)?;
        let classification = self.classify_path(path, &bytes[..bytes.len().min(128)])?;
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
        self.coverage.regular_files = self
            .coverage
            .regular_files
            .checked_add(1)
            .ok_or("counter overflow")?;
        if classification.kind != "counted" {
            self.coverage.skipped_files = self
                .coverage
                .skipped_files
                .checked_add(1)
                .ok_or("counter overflow")?;
            let count = self
                .coverage
                .skipped_by_reason
                .get_mut(classification.kind)
                .ok_or("invalid reason")?;
            *count = count.checked_add(1).ok_or("counter overflow")?;
            if classification.kind == "oversized_source"
                && !self
                    .coverage
                    .incomplete_reasons
                    .iter()
                    .any(|x| x == "oversized_source")
            {
                self.coverage
                    .incomplete_reasons
                    .push("oversized_source".into());
                self.coverage.complete = false;
            }
            return Ok(classification);
        }
        let kind =
            language(path, &bytes[..bytes.len().min(128)]).ok_or("language detection failed")?;
        let (decoded, inaccurate) = decode(bytes);
        let stats = kind.parse_from_slice(&decoded, &Config::default());
        let invalid_notebook = kind == LanguageType::Jupyter && !valid_notebook(&decoded);
        let mut file_rows = BTreeMap::new();
        add_stats(&mut file_rows, kind, &stats, true)?;
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
        for (name, row) in file_rows {
            let aggregate = self
                .languages
                .entry(name.clone())
                .or_insert_with(|| LanguageCounts {
                    language: name,
                    files: 0,
                    counts: Counts::empty(),
                });
            aggregate.files = aggregate
                .files
                .checked_add(row.files)
                .ok_or("counter overflow")?;
            aggregate.counts.code = aggregate
                .counts
                .code
                .checked_add(row.counts.code)
                .ok_or("counter overflow")?;
            aggregate.counts.comments = aggregate
                .counts
                .comments
                .checked_add(row.counts.comments)
                .ok_or("counter overflow")?;
            aggregate.counts.blanks = aggregate
                .counts
                .blanks
                .checked_add(row.counts.blanks)
                .ok_or("counter overflow")?;
            aggregate.counts.lines = aggregate
                .counts
                .code
                .checked_add(aggregate.counts.comments)
                .and_then(|n| n.checked_add(aggregate.counts.blanks))
                .ok_or("counter overflow")?;
        }
        self.inaccurate |= inaccurate || invalid_notebook;
        self.coverage.counted_files = self
            .coverage
            .counted_files
            .checked_add(1)
            .ok_or("counter overflow")?;
        self.coverage.analyzed_bytes = self
            .coverage
            .analyzed_bytes
            .checked_add(bytes.len() as u64)
            .ok_or("counter overflow")?;
        Ok(classification)
    }
    pub fn finish(mut self) -> Result<AnalysisResult, String> {
        if self.inaccurate {
            self.coverage
                .incomplete_reasons
                .push("counter_inaccurate".into());
            self.coverage.complete = false;
        }
        self.coverage.incomplete_reasons.sort();
        let mut counts = Counts::empty();
        let mut files = 0u64;
        for row in self.languages.values() {
            files = files.checked_add(row.files).ok_or("counter overflow")?;
            counts.code = counts
                .code
                .checked_add(row.counts.code)
                .ok_or("counter overflow")?;
            counts.comments = counts
                .comments
                .checked_add(row.counts.comments)
                .ok_or("counter overflow")?;
            counts.blanks = counts
                .blanks
                .checked_add(row.counts.blanks)
                .ok_or("counter overflow")?;
        }
        counts.lines = counts
            .code
            .checked_add(counts.comments)
            .and_then(|x| x.checked_add(counts.blanks))
            .ok_or("counter overflow")?;
        if counts.lines > 9_007_199_254_740_991 {
            return Err("counter overflow".into());
        }
        Ok(AnalysisResult {
            schema_version: 1,
            repository: BTreeMap::from([("id".into(), self.rules.repository_id)]),
            revision: BTreeMap::from([("commitSha".into(), self.rules.commit_sha)]),
            engine: Engine {
                name: "tokei",
                version: "15.0.0",
                wrapper_version: WRAPPER_VERSION,
                rules_profile: "source-v1",
                rules_version: RULES_VERSION,
                rules_hash: self.hash,
                coverage_policy_version: COVERAGE_VERSION,
            },
            totals: Totals { files, counts },
            languages: self.languages.into_values().collect(),
            coverage: self.coverage,
        })
    }
}

#[wasm_bindgen]
pub fn counter_metadata() -> String {
    "{\"name\":\"tokei\",\"version\":\"15.0.0\",\"wrapperVersion\":\"1\"}".into()
}

#[wasm_bindgen]
pub struct Analyzer(Option<CounterAnalyzer>);

#[wasm_bindgen]
impl Analyzer {
    #[wasm_bindgen(constructor)]
    pub fn new(rules: &str) -> Result<Analyzer, JsValue> {
        let parsed = serde_json::from_str(rules).map_err(|_| JsValue::from_str("invalid rules"))?;
        CounterAnalyzer::new(parsed)
            .map(|x| Self(Some(x)))
            .map_err(|x| JsValue::from_str(&x))
    }
    pub fn classify_path(&self, path: &str, prefix: &[u8]) -> Result<String, JsValue> {
        let x = self
            .0
            .as_ref()
            .ok_or_else(|| JsValue::from_str("analyzer finished"))?
            .classify_path(path, prefix)
            .map_err(|x| JsValue::from_str(&x))?;
        serde_json::to_string(&x).map_err(|x| JsValue::from_str(&x.to_string()))
    }
    pub fn add_file(&mut self, path: &str, bytes: &[u8]) -> Result<String, JsValue> {
        let x = self
            .0
            .as_mut()
            .ok_or_else(|| JsValue::from_str("analyzer finished"))?
            .add_file(path, bytes)
            .map_err(|x| JsValue::from_str(&x))?;
        serde_json::to_string(&x).map_err(|x| JsValue::from_str(&x.to_string()))
    }
    pub fn finish(&mut self) -> Result<String, JsValue> {
        let result = self
            .0
            .take()
            .ok_or_else(|| JsValue::from_str("analyzer finished"))?
            .finish()
            .map_err(|x| JsValue::from_str(&x))?;
        serde_json::to_string(&result).map_err(|x| JsValue::from_str(&x.to_string()))
    }
}

#[wasm_bindgen]
pub fn force_trap() {
    panic!("forced trap");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_and_skips() {
        let rules = Rules {
            repository_id: "1".into(),
            commit_sha: "a".repeat(40),
            exclusions: vec![],
        };
        let mut a = CounterAnalyzer::new(rules).unwrap();
        a.add_file("src/main.rs", b"fn main() {}\n").unwrap();
        a.add_file("vendor/a.rs", b"ignored\n").unwrap();
        let result = a.finish().unwrap();
        assert_eq!(result.totals.counts.code, 1);
        assert_eq!(result.coverage.skipped_files, 1);
    }

    #[test]
    fn malformed_notebook_marks_result_inaccurate() {
        let rules = Rules {
            repository_id: "1".into(),
            commit_sha: "a".repeat(40),
            exclusions: vec![],
        };
        let mut analyzer = CounterAnalyzer::new(rules).unwrap();
        analyzer.add_file("bad.ipynb", b"{bad json").unwrap();
        let result = analyzer.finish().unwrap();
        assert_eq!(result.coverage.incomplete_reasons, ["counter_inaccurate"]);
        assert_eq!(result.coverage.counted_files, 1);
    }

    #[test]
    fn oversized_source_is_partial_and_file_is_skipped() {
        let rules = Rules {
            repository_id: "1".into(),
            commit_sha: "a".repeat(40),
            exclusions: vec![],
        };
        let mut analyzer = CounterAnalyzer::new(rules).unwrap();
        let outcome = analyzer
            .add_file("big.rs", &vec![b'x'; MAX_FILE + 1])
            .unwrap();
        assert_eq!(outcome.kind, "oversized_source");
        let result = analyzer.finish().unwrap();
        assert_eq!(result.coverage.counted_files, 0);
        assert_eq!(result.coverage.incomplete_reasons, ["oversized_source"]);
    }
}
