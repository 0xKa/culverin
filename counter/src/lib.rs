use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn bootstrap_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_package_version() {
        assert_eq!(bootstrap_version(), env!("CARGO_PKG_VERSION"));
    }
}
