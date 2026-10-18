mod common;

use std::process::{Command, Stdio};

use common::{Fixture, ado};

#[test]
fn version_flag() {
    let out = Command::new(env!("CARGO_BIN_EXE_ado-mcp"))
        .arg("--version")
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        format!("ado-mcp {}\n", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn initialize_has_instructions() {
    let fx = Fixture::start();
    let mcp = ado(&fx, &[]);
    let result = &mcp.init;
    let instructions = result["instructions"].as_str().unwrap();
    assert!(instructions.contains("git diff"), "{instructions}");
    assert!(instructions.contains("branch"), "{instructions}");
    assert!(instructions.chars().count() < 4096);
    assert!(result["capabilities"]["tools"].is_object(), "{result}");
}

#[test]
fn missing_url_is_one_line() {
    let out = Command::new(env!("CARGO_BIN_EXE_ado-mcp"))
        .env_remove("ADO_ORG_URL")
        .env("ADO_PAT", "test-pat")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains("/plugin configure mcp-azure"), "{err}");
    assert!(!err.contains("test-pat"), "{err}");
}
