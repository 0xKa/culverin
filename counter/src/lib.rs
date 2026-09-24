mod analyzer;
mod file;
mod model;
mod rules;
mod wasm;

pub use analyzer::CounterAnalyzer;
pub use model::{AnalysisResult, Classification, Counts, Coverage, Engine, LanguageCounts, Totals};
pub use rules::Rules;
pub use wasm::{Analyzer, counter_metadata, force_trap};

#[cfg(test)]
mod tests;
