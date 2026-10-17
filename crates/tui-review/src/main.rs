use std::path::PathBuf;
use std::process::ExitCode;

#[cfg(target_env = "musl")]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

const USAGE: &str = "\
usage: tui-review review [--base REF] [--repo DIR] [--cache DIR]   review HEAD against the branch it is stacked on
       tui-review gen [--lines N] [--seed N] [--out DIR]           write a synthetic review cache (default 100000 lines)
       tui-review bench [--base REF] [--repo DIR]                  time a review of a real repository, cold and cached
       tui-review --version
";

fn main() -> ExitCode {
    #[cfg(target_env = "musl")]
    // SAFETY: before any tree-sitter call, on one thread, with one allocator family's four functions.
    unsafe {
        use libmimalloc_sys::{mi_calloc, mi_free, mi_malloc, mi_realloc};
        tree_sitter::set_allocator(Some(tree_sitter::Allocator {
            malloc: mi_malloc,
            calloc: mi_calloc,
            realloc: mi_realloc,
            free: mi_free,
        }));
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("review") => review_command(&args[1..]),
        Some("gen") => gen_command(&args[1..]),
        Some("bench") => bench_command(&args[1..]),
        Some("--version" | "-V") => {
            println!("tui-review {}", env!("CARGO_PKG_VERSION"));
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
        let value = it.next().ok_or_else(|| anyhow::anyhow!("{flag} needs a value"))?;
        out.push((flag.as_str(), value.as_str()));
    }
    Ok(out)
}

fn review_command(args: &[String]) -> anyhow::Result<()> {
    let mut options = tui_review::review::Options { repo: PathBuf::from("."), base: None, cache: None };
    for (flag, value) in flags(args, &["--base", "--repo", "--cache"])? {
        match flag {
            "--base" => options.base = Some(value.to_owned()).filter(|b| !b.is_empty()),
            "--repo" => options.repo = PathBuf::from(value),
            _ => options.cache = Some(std::path::absolute(value)?),
        }
    }
    let summary = tui_review::review::run(&options, std::io::stdout().lock())?;
    if summary.cached {
        eprintln!("tui-review review: cached, {:?}", summary.resolve);
    } else {
        eprintln!(
            "tui-review review: {} files, {} lines against {}; base {:?}, text {:?}, colour {:?}",
            summary.files, summary.lines, summary.base, summary.resolve, summary.text, summary.colour
        );
    }
    Ok(())
}

/// Reviews a real repository into a throwaway cache twice, cold then cached, and prints how long each part took.
fn bench_command(args: &[String]) -> anyhow::Result<()> {
    let cache = std::env::temp_dir().join(format!("tui-review-bench-{}", std::process::id()));
    let mut options = tui_review::review::Options { repo: PathBuf::from("."), base: None, cache: Some(cache.clone()) };
    for (flag, value) in flags(args, &["--base", "--repo"])? {
        match flag {
            "--base" => options.base = Some(value.to_owned()),
            _ => options.repo = PathBuf::from(value),
        }
    }
    let cold = tui_review::review::run(&options, std::io::sink());
    let started = std::time::Instant::now();
    let warm = tui_review::review::run(&options, std::io::sink());
    let reopen = started.elapsed();
    let _ = std::fs::remove_dir_all(&cache);
    let (cold, warm) = (cold?, warm?);
    let threads = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
    println!(
        "tui-review {} · {} files, {} diff lines against {} · {threads} threads",
        env!("CARGO_PKG_VERSION"),
        cold.files,
        cold.lines,
        cold.base
    );
    println!("  base detection      {:>10.1?}", cold.resolve);
    println!("  text (pass 1)       {:>10.1?}", cold.text);
    println!("  colours (pass 2)    {:>10.1?}", cold.colour);
    println!("  reopen, cached      {:>10.1?}{}", reopen, if warm.cached { "" } else { "  (not cached!)" });
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
    let out = out.unwrap_or_else(|| std::env::temp_dir().join(format!("tui-review-demo-{lines}")));
    let out = std::path::absolute(out)?;
    tui_review::generate::run(&out, lines, seed)
}
