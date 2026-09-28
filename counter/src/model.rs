use serde::Serialize;
use std::collections::BTreeMap;
use tokei::CodeStats;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub lines: u64,
    pub code: u64,
    pub comments: u64,
    pub blanks: u64,
}

impl Counts {
    pub(crate) fn empty() -> Self {
        Self {
            lines: 0,
            code: 0,
            comments: 0,
            blanks: 0,
        }
    }
    pub(crate) fn add(&mut self, stats: &CodeStats) -> Result<(), String> {
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
    pub total_bytes: u64,
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
