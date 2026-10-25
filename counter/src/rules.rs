use serde::Deserialize;
use sha2::{Digest, Sha256};

pub(crate) const MAX_PATH: usize = 4096;
pub(crate) const RULES_VERSION: &str = "2";
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rules {
    pub repository_id: String,
    pub commit_sha: String,
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub disabled_groups: Vec<String>,
}

pub(crate) struct Group {
    pub(crate) id: &'static str,
    pub(crate) directories: &'static [&'static str],
    pub(crate) files: &'static [&'static str],
    pub(crate) suffixes: &'static [&'static str],
}

pub(crate) const GROUPS: &[Group] = &[
    Group {
        id: "dependencies",
        directories: &[
            "bower_components",
            "node_modules",
            "third-party",
            "third_party",
            "vendor",
        ],
        files: &[],
        suffixes: &[],
    },
    Group {
        id: "build",
        directories: &[
            ".next", ".nuxt", ".output", "build", "dist", "out", "target",
        ],
        files: &[],
        suffixes: &[],
    },
    Group {
        id: "environments",
        directories: &[
            ".cache",
            ".git",
            ".parcel-cache",
            ".venv",
            "coverage",
            "venv",
        ],
        files: &[],
        suffixes: &[],
    },
    Group {
        id: "lockfiles",
        directories: &[],
        files: &[
            "bun.lock",
            "Cargo.lock",
            "composer.lock",
            "Gemfile.lock",
            "go.sum",
            "package-lock.json",
            "Pipfile.lock",
            "pnpm-lock.yaml",
            "poetry.lock",
            "yarn.lock",
        ],
        suffixes: &[],
    },
    Group {
        id: "minified",
        directories: &[],
        files: &[],
        suffixes: &[".map", ".min.css", ".min.js"],
    },
];

impl Rules {
    pub(crate) fn excludes(&self, path: &str) -> bool {
        let parts: Vec<&str> = path.split('/').collect();
        let name = parts.last().copied().unwrap_or(path);
        let built_in = GROUPS
            .iter()
            .filter(|group| !self.disabled_groups.iter().any(|x| x == group.id))
            .any(|group| {
                parts.iter().any(|part| group.directories.contains(part))
                    || group.files.contains(&name)
                    || group.suffixes.iter().any(|suffix| name.ends_with(suffix))
            });
        built_in || self.exclusions.iter().any(|rule| matches(rule, &parts))
    }
}

fn suffix_rule(rule: &str) -> Option<&str> {
    rule.strip_prefix('*')
        .filter(|suffix| suffix.len() > 1 && suffix.starts_with('.'))
        .filter(|suffix| !suffix.contains(['*', '?', '/']))
}

fn matches(rule: &str, parts: &[&str]) -> bool {
    if let Some(suffix) = suffix_rule(rule) {
        return parts.last().is_some_and(|name| name.ends_with(suffix));
    }
    let anchored = rule.starts_with('/');
    let rule = rule.strip_prefix('/').unwrap_or(rule);
    let directory = rule.ends_with('/');
    let rule = rule.strip_suffix('/').unwrap_or(rule);
    let candidates = if directory {
        &parts[..parts.len().saturating_sub(1)]
    } else {
        parts
    };
    if !anchored && !rule.contains('/') {
        return candidates.iter().any(|part| glob(rule, part));
    }
    let segments = rule.split('/');
    segments.clone().count() <= candidates.len()
        && segments
            .zip(candidates)
            .all(|(segment, part)| glob(segment, part))
}

fn glob(pattern: &str, text: &str) -> bool {
    if !pattern.contains(['*', '?']) {
        return pattern == text;
    }
    let mut pattern_rest = pattern.chars();
    let mut text_rest = text.chars();
    let mut star: Option<(std::str::Chars, std::str::Chars)> = None;
    loop {
        match (pattern_rest.clone().next(), text_rest.clone().next()) {
            (Some('*'), _) => {
                pattern_rest.next();
                star = Some((pattern_rest.clone(), text_rest.clone()));
            }
            (Some(expected), Some(actual)) if expected == '?' || expected == actual => {
                pattern_rest.next();
                text_rest.next();
            }
            (None, None) => return true,
            _ => {
                let Some((after_star, consumed)) = &mut star else {
                    return false;
                };
                if consumed.next().is_none() {
                    return false;
                }
                pattern_rest = after_star.clone();
                text_rest = consumed.clone();
            }
        }
    }
}

pub(crate) fn validate_rule(rule: &str) -> Result<(), String> {
    let invalid = || Err("invalid exclusions".to_string());
    if rule.is_empty()
        || rule.len() > 256
        || rule == "*."
        || rule.contains("**")
        || rule.contains(['\\', '\0'])
    {
        return invalid();
    }
    if suffix_rule(rule).is_some() {
        return Ok(());
    }
    let body = rule.strip_prefix('/').unwrap_or(rule);
    let body = body.strip_suffix('/').unwrap_or(body);
    if body
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return invalid();
    }
    Ok(())
}

pub(crate) fn validate_path(path: &str) -> Result<(), String> {
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

impl Rules {
    pub(crate) fn validated(mut self) -> Result<(Self, String), String> {
        if self.repository_id.is_empty()
            || !self.repository_id.bytes().all(|b| b.is_ascii_digit())
            || (self.repository_id.len() > 1 && self.repository_id.starts_with('0'))
        {
            return Err("invalid repository id".into());
        }
        if ![40, 64].contains(&self.commit_sha.len())
            || !self
                .commit_sha
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("invalid commit sha".into());
        }
        if self.exclusions.len() > 64
            || self.exclusions.iter().map(String::len).sum::<usize>() > 4096
        {
            return Err("invalid exclusions".into());
        }
        for exclusion in &self.exclusions {
            validate_rule(exclusion)?;
        }
        if self
            .disabled_groups
            .iter()
            .any(|group| !GROUPS.iter().any(|known| known.id == group))
        {
            return Err("invalid disabled groups".into());
        }
        self.disabled_groups.sort();
        self.disabled_groups.dedup();
        self.exclusions.sort();
        self.exclusions.dedup();
        let canonical = serde_json::to_vec(&(
            "source-v1",
            RULES_VERSION,
            &self.disabled_groups,
            &self.exclusions,
        ))
        .map_err(|e| e.to_string())?;
        let mut hash = String::with_capacity(64);
        const HEX: &[u8; 16] = b"0123456789abcdef";
        for byte in Sha256::digest(canonical) {
            hash.push(char::from(HEX[(byte >> 4) as usize]));
            hash.push(char::from(HEX[(byte & 0x0f) as usize]));
        }
        Ok((self, hash))
    }
}
