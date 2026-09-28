use crate::file::MAX_FILE;
#[cfg(test)]
use crate::*;
use serde_json::json;

fn rules(exclusions: &[&str]) -> Rules {
    Rules {
        repository_id: "1".into(),
        commit_sha: "a".repeat(40),
        exclusions: exclusions.iter().map(|s| (*s).into()).collect(),
        disabled_groups: vec![],
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
        "84a096db78f16d5b32a486bf2ad46766f85c4c43432848390d1af9bfeb66dec2"
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
fn counts_multiline_embedded_blocks_once() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    analyzer
        .add_file(
            "index.html",
            b"<html>\n<head>\n<style>\n.a {\n  color: red;\n}\n</style>\n</head>\n<body>\n<script>\nconst a = 1;\n\nconst b = 2;\nconst c = 3;\n</script>\n</body>\n</html>\n",
        )
        .unwrap();
    let result = analyzer.finish().unwrap();
    assert!(result.coverage.complete);
    assert_eq!(result.totals.counts.lines, 17);
    let lines = |language: &str| {
        result
            .languages
            .iter()
            .find(|r| r.language == language)
            .unwrap()
            .counts
            .lines
    };
    assert_eq!(lines("JavaScript"), 4);
    assert_eq!(lines("CSS"), 3);
    assert_eq!(lines("HTML"), 10);
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
        json!("2")
    );
}

#[test]
fn size_limit_applies_only_to_eligible_sources() {
    let bytes = vec![b'x'; MAX_FILE + 1];
    assert_eq!(
        crate::file::classify_file("large.rs", &bytes[..MAX_FILE], &rules(&[]))
            .unwrap()
            .kind,
        "counted"
    );
    assert_eq!(
        crate::file::classify_file("large.rs", &bytes, &rules(&[]))
            .unwrap()
            .kind,
        "oversized_source"
    );
    assert_eq!(
        crate::file::classify_file("vendor/large.rs", &bytes, &rules(&[]))
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
        disabled_groups: vec![],
    };
    let mut a = CounterAnalyzer::new(rules).unwrap();
    a.add_file("src/main.rs", b"fn main() {}\n").unwrap();
    a.add_file("vendor/a.rs", b"ignored\n").unwrap();
    let result = a.finish().unwrap();
    assert_eq!(result.totals.counts.code, 1);
    assert_eq!(result.coverage.skipped_files, 1);
    assert_eq!(result.coverage.analyzed_bytes, 13);
    assert_eq!(result.coverage.total_bytes, 21);
}

#[test]
fn malformed_notebook_marks_result_inaccurate() {
    let rules = Rules {
        repository_id: "1".into(),
        commit_sha: "a".repeat(40),
        exclusions: vec![],
        disabled_groups: vec![],
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
        disabled_groups: vec![],
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
        .skip_file("large.rs", b"fn ", "oversized_source", 9_000_000)
        .unwrap();
    analyzer
        .skip_file("unknown.xyz", b"text", "unsupported_language", 4)
        .unwrap();
    assert_eq!(
        analyzer
            .skip_file("another.rs", b"fn ", "excluded_by_rule", 3)
            .err()
            .unwrap(),
        "invalid skip reason"
    );
    assert_eq!(
        analyzer
            .skip_file("short.xyz", b"text", "unsupported_language", 3)
            .err()
            .unwrap(),
        "invalid skip size"
    );
    let result = analyzer.finish().unwrap();
    assert_eq!(result.coverage.regular_files, 2);
    assert_eq!(result.coverage.analyzed_bytes, 0);
    assert_eq!(result.coverage.total_bytes, 9_000_004);
    assert_eq!(result.coverage.skipped_files, 2);
    assert_eq!(result.coverage.skipped_by_reason["oversized_source"], 1);
    assert_eq!(result.coverage.skipped_by_reason["unsupported_language"], 1);
    assert_eq!(result.coverage.incomplete_reasons, ["oversized_source"]);
}

#[test]
fn known_extensionless_documents_count_as_plain_text() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    for path in [
        "README",
        "docs/LICENSE-MIT",
        "Changelog",
        "COPYING",
        "NOTICE",
        "VERSION",
    ] {
        assert_eq!(
            analyzer
                .add_file(path, b"line one\n\nline two\n")
                .unwrap()
                .kind,
            "counted"
        );
    }
    for path in ["README.bak", "mystery", "LICENSES"] {
        assert_eq!(
            analyzer.add_file(path, b"text\n").unwrap().kind,
            "unsupported_language"
        );
    }
    assert_eq!(
        analyzer
            .add_file("tools/NEWS", b"#!/usr/bin/env python\nprint(1)\n")
            .unwrap()
            .language
            .as_deref(),
        Some("Python")
    );
    let result = analyzer.finish().unwrap();
    assert_eq!(result.engine.rules_version, "2");
    let text = result
        .languages
        .iter()
        .find(|row| row.language == "Plain Text")
        .unwrap();
    assert_eq!(text.files, 6);
    assert_eq!(text.counts.code, 0);
    assert_eq!(text.counts.comments, 12);
    assert_eq!(text.counts.blanks, 6);
}

fn kind(rules: &Rules, path: &str) -> &'static str {
    crate::file::classify_path(path, b"fn main() {}\n", rules)
        .unwrap()
        .kind
}

#[test]
fn custom_rules_match_names_folders_suffixes_and_paths() {
    let active = CounterAnalyzer::new(rules(&[
        "fixtures/",
        "*.snap",
        "schema.rs",
        "docs/generated",
        "tools/gen/",
    ]))
    .unwrap()
    .rules()
    .clone();
    for path in [
        "fixtures/a.rs",
        "src/fixtures/deep/a.rs",
        "src/app.snap",
        "schema.rs",
        "api/schema.rs",
        "docs/generated",
        "docs/generated/a.rs",
        "tools/gen/a.rs",
    ] {
        assert_eq!(kind(&active, path), "excluded_by_rule", "{path}");
    }
    for path in [
        "src/fixtures.rs",
        "fixtures",
        "src/snap.rs",
        "src/schema.rs.bak.rs",
        "docs/generated.rs",
        "src/docs/generated/a.rs",
        "tools/gen",
        "tools/generator/a.rs",
    ] {
        assert_ne!(kind(&active, path), "excluded_by_rule", "{path}");
    }
}

#[test]
fn disabled_groups_restore_built_in_exclusions() {
    let mut custom = rules(&[]);
    custom.disabled_groups = vec!["build".into(), "minified".into(), "build".into()];
    let analyzer = CounterAnalyzer::new(custom).unwrap();
    let hash = analyzer.rules_hash().to_owned();
    let active = analyzer.rules().clone();
    assert_eq!(active.disabled_groups, ["build", "minified"]);
    assert_eq!(kind(&active, "build/main.rs"), "counted");
    assert_eq!(kind(&active, "target/main.rs"), "counted");
    assert_eq!(kind(&active, "app.min.js"), "counted");
    assert_eq!(kind(&active, "vendor/main.rs"), "excluded_by_rule");
    assert_eq!(kind(&active, "Cargo.lock"), "excluded_by_rule");
    assert_ne!(hash, CounterAnalyzer::new(rules(&[])).unwrap().rules_hash());
    let mut invalid = rules(&[]);
    invalid.disabled_groups = vec!["everything".into()];
    assert_eq!(
        CounterAnalyzer::new(invalid).err().unwrap(),
        "invalid disabled groups"
    );
}

#[test]
fn rejects_unsupported_rule_syntax() {
    for rule in [
        "", "/abs", "a\\b", "a?", "*", "*.", "*.a/b", "*.a*", "src/*.rs", "**/x", "a//b", "./a",
        "a/../b", "a//",
    ] {
        assert_eq!(
            CounterAnalyzer::new(rules(&[rule])).err().unwrap(),
            "invalid exclusions",
            "{rule:?}"
        );
    }
    let long = "a".repeat(257);
    assert!(CounterAnalyzer::new(rules(&[&long])).is_err());
    let many: Vec<String> = (0..65).map(|n| format!("r{n}")).collect();
    let many: Vec<&str> = many.iter().map(String::as_str).collect();
    assert!(CounterAnalyzer::new(rules(&many)).is_err());
}
