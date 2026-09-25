use crate::file::MAX_FILE;
#[cfg(test)]
use crate::*;
use serde_json::json;

fn rules(exclusions: &[&str]) -> Rules {
    Rules {
        repository_id: "1".into(),
        commit_sha: "a".repeat(40),
        exclusions: exclusions.iter().map(|s| (*s).into()).collect(),
    }
}

#[test]
fn validates_rules_and_canonicalizes_exclusions() {
    let mut invalid = rules(&[]);
    invalid.repository_id = "01".into();
    assert_eq!(
        CounterAnalyzer::new(invalid).err().unwrap(),
        "invalid repository id"
    );
    let mut invalid = rules(&[]);
    invalid.commit_sha = "A".repeat(40);
    assert_eq!(
        CounterAnalyzer::new(invalid).err().unwrap(),
        "invalid commit sha"
    );
    assert_eq!(
        CounterAnalyzer::new(rules(&["src/*"])).err().unwrap(),
        "invalid exclusions"
    );
    let sorted = CounterAnalyzer::new(rules(&["a", "z"]))
        .unwrap()
        .finish()
        .unwrap();
    let unsorted = CounterAnalyzer::new(rules(&["z", "a", "a"]))
        .unwrap()
        .finish()
        .unwrap();
    assert_eq!(sorted.engine.rules_hash, unsorted.engine.rules_hash);
    assert_eq!(
        sorted.engine.rules_hash,
        "bf0ff4729cbae29835822ec86026ea30df862fd4b9cd3a3f0b103583e7c8e57a"
    );
}

#[test]
fn rejects_invalid_paths_and_prefixes_before_counting() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    for path in ["", "/a.rs", "a/../b.rs", "a//b.rs", "a\\b.rs", "a\0b.rs"] {
        assert_eq!(analyzer.add_file(path, b"x").err().unwrap(), "invalid path");
    }
    assert_eq!(
        analyzer.classify_path("a.rs", &[b'x'; 129]).err().unwrap(),
        "prefix exceeds byte limit"
    );
    let result = analyzer.finish().unwrap();
    assert_eq!(result.coverage.regular_files, 0);
}

#[test]
fn preserves_skip_precedence_and_utf16_handling() {
    let mut analyzer = CounterAnalyzer::new(rules(&["custom"])).unwrap();
    assert_eq!(
        analyzer.add_file("custom/a.rs", &[0]).unwrap().kind,
        "excluded_by_rule"
    );
    assert_eq!(
        analyzer.add_file("unknown.xyz", &[0]).unwrap().kind,
        "binary_content"
    );
    assert_eq!(
        analyzer.add_file("unknown.xyz", b"text").unwrap().kind,
        "unsupported_language"
    );
    assert_eq!(
        analyzer
            .add_file("body.rs", &[&[b'x'; 129][..], &[0][..]].concat())
            .unwrap()
            .kind,
        "binary_content"
    );
    assert_eq!(
        analyzer
            .add_file("bom.py", &[0xff, 0xfe, b'x', 0, b'\n', 0])
            .unwrap()
            .kind,
        "counted"
    );
    let result = analyzer.finish().unwrap();
    assert_eq!(result.coverage.regular_files, 5);
    assert_eq!(result.coverage.counted_files, 1);
    assert_eq!(result.coverage.skipped_by_reason["binary_content"], 2);
    assert!(result.coverage.complete);
}

#[test]
fn counts_extensionless_shebang_and_preserves_embedded_attribution() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    assert_eq!(
        analyzer
            .add_file("script", b"#!/usr/bin/env python3\nprint(1)\n")
            .unwrap()
            .language
            .as_deref(),
        Some("Python")
    );
    analyzer
        .add_file("index.html", b"<script>const x = 1;</script>\n")
        .unwrap();
    let result = analyzer.finish().unwrap();
    assert_eq!(result.totals.files, result.coverage.counted_files);
    assert_eq!(
        result.totals.counts.lines,
        result.languages.iter().map(|r| r.counts.lines).sum::<u64>()
    );
    assert_eq!(
        result
            .languages
            .iter()
            .find(|r| r.language == "JavaScript")
            .unwrap()
            .files,
        0
    );
    assert_eq!(result.totals.counts.lines, 3);
}

#[test]
fn malformed_utf8_marks_coverage_inaccurate() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    analyzer.add_file("bad.py", b"print('\xff')\n").unwrap();
    let result = analyzer.finish().unwrap();
    assert_eq!(result.coverage.incomplete_reasons, ["counter_inaccurate"]);
    assert_eq!(result.coverage.counted_files, 1);
    assert_eq!(
        serde_json::to_value(&result).unwrap()["engine"]["wrapperVersion"],
        json!("1")
    );
}

#[test]
fn size_limit_applies_only_to_eligible_sources() {
    let bytes = vec![b'x'; MAX_FILE + 1];
    assert_eq!(
        crate::file::classify_file("large.rs", &bytes[..MAX_FILE], &[])
            .unwrap()
            .kind,
        "counted"
    );
    assert_eq!(
        crate::file::classify_file("large.rs", &bytes, &[])
            .unwrap()
            .kind,
        "oversized_source"
    );
    assert_eq!(
        crate::file::classify_file("vendor/large.rs", &bytes, &[])
            .unwrap()
            .kind,
        "excluded_by_rule"
    );
}
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

#[test]
fn streamed_skip_records_only_valid_classification() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    analyzer
        .skip_file("large.rs", b"fn ", "oversized_source")
        .unwrap();
    analyzer
        .skip_file("unknown.xyz", b"text", "unsupported_language")
        .unwrap();
    assert_eq!(
        analyzer
            .skip_file("another.rs", b"fn ", "excluded_by_rule")
            .err()
            .unwrap(),
        "invalid skip reason"
    );
    let result = analyzer.finish().unwrap();
    assert_eq!(result.coverage.regular_files, 2);
    assert_eq!(result.coverage.skipped_files, 2);
    assert_eq!(result.coverage.skipped_by_reason["oversized_source"], 1);
    assert_eq!(result.coverage.skipped_by_reason["unsupported_language"], 1);
    assert_eq!(result.coverage.incomplete_reasons, ["oversized_source"]);
}
