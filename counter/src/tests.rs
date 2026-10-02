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
fn malformed_utf8_counts_exactly_and_bad_utf16_is_binary() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    analyzer
        .add_file("bad.py", b"print('\xff')\n# \xfe\n\n")
        .unwrap();
    assert_eq!(
        analyzer
            .add_file("surrogate.py", &[0xff, 0xfe, 0x00, 0xd8, b'\n', 0])
            .unwrap()
            .kind,
        "binary_content"
    );
    assert_eq!(
        analyzer
            .add_file("odd.py", &[0xfe, 0xff, 0, b'x', 0])
            .unwrap()
            .kind,
        "binary_content"
    );
    let result = analyzer.finish().unwrap();
    assert!(result.coverage.complete);
    assert!(result.coverage.incomplete_reasons.is_empty());
    assert_eq!(result.coverage.counted_files, 1);
    assert_eq!(result.coverage.skipped_by_reason["binary_content"], 2);
    assert_eq!(
        result.totals.counts,
        Counts {
            lines: 3,
            code: 1,
            comments: 1,
            blanks: 1,
        }
    );
    assert_eq!(
        serde_json::to_value(&result).unwrap()["engine"]["wrapperVersion"],
        json!("3")
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
fn notebooks_count_each_cell_line_once() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    let fenced = json!({
        "cells": [
            {"cell_type": "markdown", "source": ["# T\n", "```rust\n", "fn main() {}\n", "```\n"]},
            {"cell_type": "raw", "source": ["raw\n"]},
            {"cell_type": "code", "source": "x = 1\ny = 2\n", "outputs": []}
        ],
        "metadata": {"kernelspec": {"language": "python"}},
        "nbformat": 4,
        "nbformat_minor": 5
    });
    analyzer
        .add_file("fenced.ipynb", fenced.to_string().as_bytes())
        .unwrap();
    let plain = json!({
        "cells": [{"cell_type": "code", "source": ["fn main() {}\n"]}],
        "metadata": {"language_info": {"file_extension": ".rs"}},
        "nbformat": 4,
        "nbformat_minor": 5
    });
    analyzer
        .add_file("plain.ipynb", plain.to_string().as_bytes())
        .unwrap();
    let result = analyzer.finish().unwrap();
    let lines = |name: &str| {
        result
            .languages
            .iter()
            .find(|r| r.language == name)
            .unwrap()
            .counts
            .lines
    };
    assert!(result.coverage.complete);
    assert_eq!(lines("Jupyter Notebooks"), 0);
    assert_eq!(lines("Markdown"), 3);
    assert_eq!(lines("Python"), 2);
    assert_eq!(lines("Rust"), 2);
    assert_eq!(result.totals.counts.lines, 7);
    assert_eq!(result.totals.files, 2);
}

#[test]
fn unreadable_notebook_is_skipped() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    for (path, bytes) in [
        ("bad.ipynb", &b"{bad json"[..]),
        ("v3.ipynb", br#"{"worksheets":[{"cells":[]}],"nbformat":3}"#),
    ] {
        assert_eq!(
            analyzer.add_file(path, bytes).unwrap().kind,
            "unsupported_notebook"
        );
    }
    let result = analyzer.finish().unwrap();
    assert!(result.coverage.complete);
    assert_eq!(result.coverage.counted_files, 0);
    assert_eq!(result.coverage.skipped_by_reason["unsupported_notebook"], 2);
    assert_eq!(result.coverage.analyzed_bytes, 0);
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
    assert_eq!(result.coverage.oversized_files[0].path, "big.rs");
    assert_eq!(
        result.coverage.oversized_files[0].bytes,
        (MAX_FILE + 1) as u64
    );
}

#[test]
fn oversized_file_details_are_bounded_and_independent_of_input_order() {
    let max = crate::analyzer::MAX_OVERSIZED_FILES;
    let analyze = |reverse: bool| {
        let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
        let mut indexes: Vec<usize> = (0..max + 2).collect();
        if reverse {
            indexes.reverse();
        }
        for i in indexes {
            analyzer
                .skip_file(
                    &format!("src/{i:03}.rs"),
                    b"fn ",
                    "oversized_source",
                    (MAX_FILE + 1 + i / 2) as u64,
                )
                .unwrap();
        }
        analyzer
            .skip_file("vendor/large.rs", b"fn ", "excluded_by_rule", 9_000_000)
            .unwrap();
        analyzer.finish().unwrap().coverage
    };
    let forward = analyze(false);
    let reverse = analyze(true);
    assert_eq!(forward.oversized_files, reverse.oversized_files);
    assert_eq!(forward.oversized_files.len(), max);
    assert_eq!(
        forward.skipped_by_reason["oversized_source"],
        (max + 2) as u64
    );
    assert_eq!(forward.oversized_files[0].path, "src/256.rs");
    assert_eq!(forward.oversized_files[max - 1].path, "src/003.rs");
}

#[test]
fn streamed_skip_records_only_valid_classification() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    analyzer
        .skip_file("large.rs", b"fn ", "oversized_source", 9_000_000)
        .unwrap();
    assert_eq!(
        analyzer
            .skip_file("small.rs", b"fn ", "oversized_source", MAX_FILE as u64)
            .err()
            .unwrap(),
        "invalid skip size"
    );
    analyzer
        .skip_other("unknown.xyz", b"text", 4, 1, false)
        .unwrap();
    for (path, reason) in [
        ("another.rs", "excluded_by_rule"),
        ("unknown.xyz", "unsupported_language"),
    ] {
        assert_eq!(
            analyzer.skip_file(path, b"text", reason, 4).err().unwrap(),
            "invalid skip reason"
        );
    }
    assert_eq!(
        analyzer
            .skip_other("another.rs", b"fn ", 3, 1, false)
            .err()
            .unwrap(),
        "invalid skip reason"
    );
    for (prefix, size, lines, binary) in [
        (&b"text"[..], 3, 1, false),
        (b"text", 4, 5, false),
        (&[0xff, 0xfe, b'x', 0], 4, 1, false),
    ] {
        assert_eq!(
            analyzer
                .skip_other("short.xyz", prefix, size, lines, binary)
                .err()
                .unwrap(),
            "invalid skip size"
        );
    }
    let result = analyzer.finish().unwrap();
    assert_eq!(result.coverage.regular_files, 2);
    assert_eq!(result.coverage.analyzed_bytes, 0);
    assert_eq!(result.coverage.total_bytes, 9_000_004);
    assert_eq!(result.coverage.skipped_files, 2);
    assert_eq!(result.coverage.skipped_by_reason["oversized_source"], 1);
    assert_eq!(result.coverage.skipped_by_reason["unsupported_language"], 1);
    assert_eq!(result.coverage.incomplete_reasons, ["oversized_source"]);
    assert_eq!(result.coverage.oversized_files.len(), 1);
    assert_eq!(result.coverage.oversized_files[0].path, "large.rs");
    assert_eq!(result.coverage.oversized_files[0].bytes, 9_000_000);
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

#[test]
fn other_files_are_grouped_by_extension() {
    let mut analyzer = CounterAnalyzer::new(rules(&[])).unwrap();
    for (path, bytes) in [
        ("a/one.golden", &b"x\ny\n"[..]),
        ("b/two.GOLDEN", b"z"),
        ("data.out", b"1\n2\n3\n"),
        ("hello", b"hi\n"),
        ("mod/v0.0.0-20200325131415-0123456789ab", b"a\n"),
        ("trailing.", b"a\n"),
        (".gitignore", b"target\n"),
        ("bad.ext!", b"x\n"),
        ("config.yml~", b"a\nb\n"),
        ("\u{e9}t\u{e9}.\u{c9}T\u{c9}", b"a\n"),
        ("empty.out", b""),
        ("late.zst", b"text\0"),
    ] {
        analyzer.add_file(path, bytes).unwrap();
    }
    assert_eq!(
        analyzer
            .skip_other("big.out", b"0123", 100, 4, false)
            .unwrap()
            .kind,
        "unsupported_language"
    );
    assert_eq!(
        analyzer
            .skip_other("blob.dat", b"0123", 100, 0, true)
            .unwrap()
            .kind,
        "binary_content"
    );
    for n in 0..110 {
        analyzer.add_file(&format!("f.zz{n}"), b"").unwrap();
    }
    let result = analyzer.finish().unwrap();
    assert!(result.coverage.complete);
    assert_eq!(result.totals.files, 0);
    assert_eq!(
        result.coverage.skipped_by_reason["unsupported_language"],
        122
    );
    assert_eq!(result.coverage.skipped_by_reason["binary_content"], 2);
    assert_eq!(result.other_files.files, 122);
    assert_eq!(result.other_files.lines, 18);
    assert_eq!(result.other_files.more_extensions, 17);
    let rows: Vec<_> = result
        .other_files
        .extensions
        .iter()
        .map(|x| (x.extension.as_str(), x.files, x.lines))
        .collect();
    assert_eq!(
        rows[..8],
        [
            (".out", 3, 7),
            ("", 3, 3),
            (".golden", 2, 3),
            (".yml~", 1, 2),
            (".ext!", 1, 1),
            (".gitignore", 1, 1),
            (".\u{e9}t\u{e9}", 1, 1),
            (".zz0", 1, 0),
        ]
    );
    assert_eq!(rows.len(), 100);
}
