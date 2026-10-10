use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
usage: brv review [--base REF] [--repo DIR] [--cache DIR]   review HEAD against the branch it is stacked on
       brv gen [--lines N] [--seed N] [--out DIR]           write a synthetic review cache (default 100000 lines)
       brv --version
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("review") => review_command(&args[1..]),
        Some("gen") => gen_command(&args[1..]),
        Some("--version" | "-V") => {
            println!("brv {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
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

/// Pairs of `--flag value`, checked against `known`.
fn flags<'a>(args: &'a [String], known: &[&str]) -> anyhow::Result<Vec<(&'a str, &'a str)>> {
    let mut out = Vec::new();
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        if !known.contains(&flag.as_str()) {
            anyhow::bail!("unknown flag {flag}\n{USAGE}");
        }
        let value = it
            .next()
            .ok_or_else(|| anyhow::anyhow!("{flag} needs a value"))?;
        out.push((flag.as_str(), value.as_str()));
    }
    Ok(out)
}

fn review_command(args: &[String]) -> anyhow::Result<()> {
    let mut options = brv::review::Options {
        repo: PathBuf::from("."),
        base: None,
        cache: None,
    };
    for (flag, value) in flags(args, &["--base", "--repo", "--cache"])? {
        match flag {
            "--base" => options.base = Some(value.to_owned()).filter(|b| !b.is_empty()),
            "--repo" => options.repo = PathBuf::from(value),
            _ => options.cache = Some(std::path::absolute(value)?),
        }
    }
    let summary = brv::review::run(&options, std::io::stdout().lock())?;
    if summary.cached {
        eprintln!("brv review: cached, {:?}", summary.resolve);
    } else {
        eprintln!(
            "brv review: {} files, {} lines against {}; base {:?}, text {:?}, colour {:?}",
            summary.files,
            summary.lines,
            summary.base,
            summary.resolve,
            summary.text,
            summary.colour
        );
    }
    Ok(())
}

fn gen_command(args: &[String]) -> anyhow::Result<()> {
    let mut lines = 100_000;
    let mut seed = 0x5eed;
    let mut out = None;
    for (flag, value) in flags(args, &["--lines", "--seed", "--out"])? {
        match flag {
            "--lines" => lines = value.parse()?,
            "--seed" => seed = value.parse()?,
            _ => out = Some(PathBuf::from(value)),
        }
    }
    let out = out.unwrap_or_else(|| std::env::temp_dir().join(format!("brv-demo-{lines}")));
    let out = std::path::absolute(out)?;
    brv::generate::run(&out, lines, seed)
}
