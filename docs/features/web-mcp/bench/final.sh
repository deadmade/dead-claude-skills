#!/usr/bin/env bash
# Task 18: web-mcp's final measurement. Run from anywhere in the repo, in a normal terminal.
# Needs: cargo, node, an authenticated `claude`, curl, python3, and Docker (or SearXNG already on 127.0.0.1:8888).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
res=docs/features/web-mcp/bench/results
out=$res/$(hostname)-$(date +%F)-web-mcp
log=$res/$(hostname)-$(date +%F)-final.log
mkdir -p "$out"
exec > >(tee "$log") 2>&1

searxng() { curl -sf --max-time 5 'http://127.0.0.1:8888/search?q=rust&format=json' >/dev/null; }

echo "== SearXNG"
if ! searxng; then
  command -v docker >/dev/null || { echo "SearXNG is not on :8888 and Docker is missing."; exit 1; }
  # Same setup as the installer: ~/.claude/searxng/settings.yml (JSON on), kept if it exists.
  conf=$HOME/.claude/searxng
  mkdir -p "$conf"
  [ -f "$conf/settings.yml" ] ||
    sed "s/^\(\s*secret_key:\).*/\1 \"$(openssl rand -hex 32)\"/" installer/searxng.yml >"$conf/settings.yml"
  docker start searxng 2>/dev/null || docker run -d --name searxng --restart unless-stopped \
    -p 127.0.0.1:8888:8080 -v "$conf:/etc/searxng/" docker.io/searxng/searxng:latest
  for _ in $(seq 30); do searxng && break; sleep 1; done
  searxng || { echo "SearXNG did not answer JSON within 30 s (see: docker logs searxng)."; exit 1; }
fi
echo "SearXNG answers"

echo "== build"
(cd plugins/web-mcp/server &&
  cargo build --release &&
  cargo build --release --features test-hooks --target-dir target/test-hooks)
bin=plugins/web-mcp/server/target/release/web-mcp

echo "== H1-H3, H6: baseline.mjs through claude -p (the long part)"
node docs/features/web-mcp/bench/baseline.mjs --target web-mcp --bin "$bin" --runs 3 \
  --only search,fetch,parallel,papers --out "$out"

echo "== H5: concurrency on local stub pages (judged)"
node docs/features/web-mcp/bench/concurrency.mjs --bin plugins/web-mcp/server/target/test-hooks/release/web-mcp

echo "== done: results in $out, log in $log"
