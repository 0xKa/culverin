use culverin_counter::{CounterAnalyzer, Rules};
use serde::Deserialize;
use std::io::{self, Read};

#[derive(Deserialize)]
struct Fixture {
    rules: Rules,
    files: Vec<File>,
}

#[derive(Deserialize)]
struct File {
    path: String,
    bytes: Vec<u8>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let fixture: Fixture = serde_json::from_str(&input)?;
    let mut analyzer = CounterAnalyzer::new(fixture.rules)?;
    for file in fixture.files {
        analyzer.add_file(&file.path, &file.bytes)?;
    }
    println!("{}", serde_json::to_string(&analyzer.finish()?)?);
    Ok(())
}
