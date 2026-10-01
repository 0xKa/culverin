use crate::file::{
    FileAnalysis, MAX_OTHER_EXTENSIONS, merge_rows, other_extension, physical_lines,
};
use crate::model::{
    AnalysisResult, Classification, Counts, Coverage, Engine, LanguageCounts, OtherExtension,
    OtherFiles, Totals,
};
use crate::rules::{RULES_VERSION, Rules};

const COVERAGE_VERSION: &str = "2";
const WRAPPER_VERSION: &str = "3";
use std::collections::BTreeMap;

pub struct CounterAnalyzer {
    rules: Rules,
    hash: String,
    languages: BTreeMap<String, LanguageCounts>,
    others: BTreeMap<String, (u64, u64)>,
    coverage: Coverage,
}

impl CounterAnalyzer {
    pub fn new(rules: Rules) -> Result<Self, String> {
        let (rules, hash) = rules.validated()?;
        let skipped_by_reason = [
            "excluded_by_rule",
            "unsupported_language",
            "binary_content",
            "oversized_source",
            "unsupported_notebook",
        ]
        .into_iter()
        .map(|s| (s.to_owned(), 0))
        .collect();
        Ok(Self {
            rules,
            hash,
            languages: BTreeMap::new(),
            others: BTreeMap::new(),
            coverage: Coverage {
                regular_files: 0,
                counted_files: 0,
                analyzed_bytes: 0,
                total_bytes: 0,
                skipped_files: 0,
                skipped_by_reason,
                complete: true,
                incomplete_reasons: vec![],
            },
        })
    }
    pub fn rules(&self) -> &Rules {
        &self.rules
    }
    pub fn rules_hash(&self) -> &str {
        &self.hash
    }
    pub fn classify_path(&self, path: &str, prefix: &[u8]) -> Result<Classification, String> {
        crate::file::classify_path(path, prefix, &self.rules)
    }
    pub fn add_file(&mut self, path: &str, bytes: &[u8]) -> Result<Classification, String> {
        let classification = crate::file::classify_file(path, bytes, &self.rules)?;
        self.record_file(bytes.len() as u64)?;
        if classification.kind == "unsupported_language" {
            return self.record_other(path, physical_lines(bytes), bytes.contains(&0));
        }
        if classification.kind != "counted" {
            self.record_skip(classification.kind)?;
            return Ok(classification);
        }
        let rows = match crate::file::analyze_counted(path, bytes)? {
            FileAnalysis::Counted(rows) => rows,
            FileAnalysis::Skipped(kind) => {
                self.record_skip(kind)?;
                return Ok(Classification {
                    kind,
                    language: None,
                });
            }
        };
        merge_rows(&mut self.languages, rows)?;
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
    pub fn skip_file(
        &mut self,
        path: &str,
        prefix: &[u8],
        reason: &str,
        size: u64,
    ) -> Result<(), String> {
        let classification = self.classify_path(path, prefix)?;
        if reason == "unsupported_language"
            || classification.kind != reason
                && !(classification.kind == "counted" && reason == "oversized_source")
        {
            return Err("invalid skip reason".into());
        }
        if (prefix.len() as u64) > size {
            return Err("invalid skip size".into());
        }
        self.record_file(size)?;
        self.record_skip(reason)
    }
    pub fn skip_other(
        &mut self,
        path: &str,
        prefix: &[u8],
        size: u64,
        lines: u64,
        binary: bool,
    ) -> Result<Classification, String> {
        if self.classify_path(path, prefix)?.kind != "unsupported_language" {
            return Err("invalid skip reason".into());
        }
        if (prefix.len() as u64) > size || lines > size || prefix.contains(&0) && !binary {
            return Err("invalid skip size".into());
        }
        self.record_file(size)?;
        self.record_other(path, lines, binary)
    }
    fn record_other(
        &mut self,
        path: &str,
        lines: u64,
        binary: bool,
    ) -> Result<Classification, String> {
        let kind = if binary {
            "binary_content"
        } else {
            "unsupported_language"
        };
        self.record_skip(kind)?;
        if !binary {
            let entry = self.others.entry(other_extension(path)).or_insert((0, 0));
            entry.0 = entry.0.checked_add(1).ok_or("counter overflow")?;
            entry.1 = entry.1.checked_add(lines).ok_or("counter overflow")?;
        }
        Ok(Classification {
            kind,
            language: None,
        })
    }
    fn record_file(&mut self, size: u64) -> Result<(), String> {
        self.coverage.regular_files = self
            .coverage
            .regular_files
            .checked_add(1)
            .ok_or("counter overflow")?;
        self.coverage.total_bytes = self
            .coverage
            .total_bytes
            .checked_add(size)
            .ok_or("counter overflow")?;
        Ok(())
    }
    fn record_skip(&mut self, reason: &str) -> Result<(), String> {
        self.coverage.skipped_files = self
            .coverage
            .skipped_files
            .checked_add(1)
            .ok_or("counter overflow")?;
        let count = self
            .coverage
            .skipped_by_reason
            .get_mut(reason)
            .ok_or("invalid reason")?;
        *count = count.checked_add(1).ok_or("counter overflow")?;
        if reason == "oversized_source"
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
        Ok(())
    }

    pub fn finish(self) -> Result<AnalysisResult, String> {
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
        let mut other_files = OtherFiles {
            files: 0,
            lines: 0,
            extensions: vec![],
            more_extensions: 0,
        };
        for (extension, (files, lines)) in self.others {
            other_files.files = other_files
                .files
                .checked_add(files)
                .ok_or("counter overflow")?;
            other_files.lines = other_files
                .lines
                .checked_add(lines)
                .ok_or("counter overflow")?;
            other_files.extensions.push(OtherExtension {
                extension,
                files,
                lines,
            });
        }
        if other_files.lines > 9_007_199_254_740_991 {
            return Err("counter overflow".into());
        }
        other_files.extensions.sort_by(|a, b| {
            b.lines
                .cmp(&a.lines)
                .then(b.files.cmp(&a.files))
                .then(a.extension.cmp(&b.extension))
        });
        other_files.more_extensions = other_files
            .extensions
            .len()
            .saturating_sub(MAX_OTHER_EXTENSIONS) as u64;
        other_files.extensions.truncate(MAX_OTHER_EXTENSIONS);
        Ok(AnalysisResult {
            schema_version: 2,
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
            other_files,
            coverage: self.coverage,
        })
    }
}
