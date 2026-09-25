use crate::model::{
    AnalysisResult, Classification, Counts, Coverage, Engine, LanguageCounts, Totals,
};
use crate::rules::{RULES_VERSION, Rules};

const COVERAGE_VERSION: &str = "1";
const WRAPPER_VERSION: &str = "1";
use std::collections::BTreeMap;

pub struct CounterAnalyzer {
    rules: Rules,
    hash: String,
    languages: BTreeMap<String, LanguageCounts>,
    coverage: Coverage,
    inaccurate: bool,
}

impl CounterAnalyzer {
    pub fn new(rules: Rules) -> Result<Self, String> {
        let (rules, hash) = rules.validated()?;
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
        crate::file::classify_path(path, prefix, &self.rules.exclusions)
    }
    pub fn add_file(&mut self, path: &str, bytes: &[u8]) -> Result<Classification, String> {
        let classification = crate::file::classify_file(path, bytes, &self.rules.exclusions)?;
        self.coverage.regular_files = self
            .coverage
            .regular_files
            .checked_add(1)
            .ok_or("counter overflow")?;
        if classification.kind != "counted" {
            self.record_skip(classification.kind)?;
            return Ok(classification);
        }
        let analysis = crate::file::analyze_counted(path, bytes)?;
        self.merge_rows(analysis.rows)?;
        self.inaccurate |= analysis.inaccurate;
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
    pub fn skip_file(&mut self, path: &str, prefix: &[u8], reason: &str) -> Result<(), String> {
        let classification = self.classify_path(path, prefix)?;
        if classification.kind != reason
            && !(classification.kind == "counted" && reason == "oversized_source")
        {
            return Err("invalid skip reason".into());
        }
        self.coverage.regular_files = self
            .coverage
            .regular_files
            .checked_add(1)
            .ok_or("counter overflow")?;
        self.record_skip(reason)
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

    fn merge_rows(&mut self, rows: BTreeMap<String, LanguageCounts>) -> Result<(), String> {
        for (name, row) in rows {
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
        Ok(())
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
