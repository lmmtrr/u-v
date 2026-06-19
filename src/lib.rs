#![allow(dead_code)]
#![allow(non_snake_case)]
#![allow(non_upper_case_globals)]
pub mod environment;
#[cfg(test)]
mod tests {
    use super::environment::Environment;
    use std::fs;
    #[test]
    fn test_load() {
        let data = fs::read("1.ab").expect("Failed to read 1.ab");
        let _env = Environment::new(data);
    }
}
