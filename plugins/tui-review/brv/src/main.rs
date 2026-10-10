use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
usage: brv gen [--lines N] [--seed N] [--out DIR]   write a synthetic review cache (default 100000 lines)
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("gen") => gen_command(&args[1..]),
        Some("help" | "--help" | "-h") => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        _ => {
            eprint!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            // The mod reads this line; keep it one line.
            println!("error {}", format!("{err:#}").replace('\n', " "));
            ExitCode::FAILURE
        }
    }
}

fn gen_command(args: &[String]) -> anyhow::Result<()> {
    let mut lines = 100_000;
    let mut seed = 0x5eed;
    let mut out = None;
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let value = it.next().ok_or_else(|| anyhow::anyhow!("{flag} needs a value"))?;
        match flag.as_str() {
            "--lines" => lines = value.parse()?,
            "--seed" => seed = value.parse()?,
            "--out" => out = Some(PathBuf::from(value)),
            _ => anyhow::bail!("unknown flag {flag}\n{USAGE}"),
        }
    }
    let out = out.unwrap_or_else(|| std::env::temp_dir().join(format!("brv-demo-{lines}")));
    let out = std::path::absolute(out)?;
    brv::generate::run(&out, lines, seed)
}
