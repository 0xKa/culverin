use crate::CounterAnalyzer;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn counter_metadata() -> String {
    "{\"name\":\"tokei\",\"version\":\"15.0.0\",\"wrapperVersion\":\"2\"}".into()
}

#[wasm_bindgen]
pub struct Analyzer(Option<CounterAnalyzer>);

#[wasm_bindgen]
impl Analyzer {
    #[wasm_bindgen(constructor)]
    pub fn new(rules: &str) -> Result<Analyzer, JsValue> {
        let parsed = serde_json::from_str(rules).map_err(|_| JsValue::from_str("invalid rules"))?;
        CounterAnalyzer::new(parsed)
            .map(|x| Self(Some(x)))
            .map_err(|x| JsValue::from_str(&x))
    }
    pub fn classify_path(&self, path: &str, prefix: &[u8]) -> Result<String, JsValue> {
        let x = self
            .0
            .as_ref()
            .ok_or_else(|| JsValue::from_str("analyzer finished"))?
            .classify_path(path, prefix)
            .map_err(|x| JsValue::from_str(&x))?;
        serde_json::to_string(&x).map_err(|x| JsValue::from_str(&x.to_string()))
    }
    pub fn add_file(&mut self, path: &str, bytes: &[u8]) -> Result<String, JsValue> {
        let x = self
            .0
            .as_mut()
            .ok_or_else(|| JsValue::from_str("analyzer finished"))?
            .add_file(path, bytes)
            .map_err(|x| JsValue::from_str(&x))?;
        serde_json::to_string(&x).map_err(|x| JsValue::from_str(&x.to_string()))
    }
    pub fn skip_file(&mut self, path: &str, prefix: &[u8], reason: &str) -> Result<(), JsValue> {
        self.0
            .as_mut()
            .ok_or_else(|| JsValue::from_str("analyzer finished"))?
            .skip_file(path, prefix, reason)
            .map_err(|x| JsValue::from_str(&x))
    }
    pub fn finish(&mut self) -> Result<String, JsValue> {
        let result = self
            .0
            .take()
            .ok_or_else(|| JsValue::from_str("analyzer finished"))?
            .finish()
            .map_err(|x| JsValue::from_str(&x))?;
        serde_json::to_string(&result).map_err(|x| JsValue::from_str(&x.to_string()))
    }
}

#[wasm_bindgen]
pub fn force_trap() {
    panic!("forced trap");
}
