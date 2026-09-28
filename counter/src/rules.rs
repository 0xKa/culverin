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
}

pub(crate) fn excluded(path: &str, custom: &[String]) -> bool {
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
            || self.exclusions.iter().any(|x| x.len() > 256)
            || self.exclusions.iter().map(String::len).sum::<usize>() > 4096
        {
            return Err("invalid exclusions".into());
        }
        for exclusion in &self.exclusions {
            validate_path(exclusion)?;
            if exclusion.contains('*') || exclusion.contains('?') {
                return Err("invalid exclusions".into());
            }
        }
        self.exclusions.sort();
        self.exclusions.dedup();
        let canonical = serde_json::to_vec(&("source-v1", RULES_VERSION, &self.exclusions))
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
