"""The trim server: POST /hook trims a PostToolUse tool_response, GET /health, POST /shutdown.

python <abs>/server.py --port <int> --data <dir> --lock-hash <hex> [--idle <seconds>]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # the cwd is the user's project, never ours

import guard  # noqa: E402

guard.install()  # before anything else can reach for the network

for _key, _value in {
    "HEADROOM_OFFLINE": "1",
    "HEADROOM_BEACON": "off",
    "HEADROOM_TELEMETRY": "off",
    "DO_NOT_TRACK": "1",
    "HEADROOM_UPDATE_CHECK": "off",
    "HF_HUB_OFFLINE": "1",
    "HEADROOM_CCR_BACKEND": "memory",
}.items():
    os.environ[_key] = _value
import argparse  # noqa: E402

_early = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
_early.add_argument("--data")
_data = _early.parse_known_args()[0].data
if _data:  # headroom and tiktoken read their folders at import
    os.environ["HEADROOM_WORKSPACE_DIR"] = os.path.join(_data, "headroom")
    os.environ["TIKTOKEN_CACHE_DIR"] = os.path.join(_data, "tiktoken")

import headroom.telemetry.session as _session  # noqa: E402

_session.post_session_event = lambda *a, **k: None
_session._post_blocking = lambda *a, **k: None

import json  # noqa: E402
import logging  # noqa: E402
import logging.handlers  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402
from pathlib import Path  # noqa: E402

import trim  # noqa: E402

PORT_TAKEN = 75


class PortTaken(Exception):
    pass


class Handler(BaseHTTPRequestHandler):
    timeout = 5  # the hook's own timeout: a stalled client must not hold a thread forever

    def log_message(self, *args):
        pass

    def reply(self, body=b"", content_type="application/json"):
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        return self.rfile.read(int(self.headers.get("content-length") or 0))

    def do_GET(self):
        self.server.touch()
        if self.path == "/health":
            self.reply(json.dumps({"ok": True, "lock": self.server.lock_hash}).encode())
        else:
            self.send_error(404)

    def do_POST(self):
        self.server.touch()
        if self.path == "/hook":
            try:
                body = self.read_body()
                with self.server.compress_lock:  # one pipeline; also held until the answer is out, so a shutdown waits
                    self.reply(self.server.trim(body))
            except Exception:  # every failure gives Claude the original output
                try:
                    self.reply()
                except Exception:
                    pass
        elif self.path == "/shutdown" and self.client_address[0] == "127.0.0.1":
            self.read_body()
            self.reply()
            threading.Thread(target=self.server.shutdown).start()
        else:
            self.send_error(404)


class TrimServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = sys.platform != "win32"  # on Windows it would let a second server share the port

    def __init__(self, port, data, lock_hash, idle, trim_text):
        super().__init__(("127.0.0.1", port), Handler, bind_and_activate=False)
        self.lock_hash = lock_hash
        self.idle = idle
        self.trim_text = trim_text or (lambda tool, text: trim.headroom_text(tool, text))
        self.compress_lock = threading.Lock()
        self.timer_lock = threading.Lock()
        self.timer = None
        data = Path(data)
        data.mkdir(parents=True, exist_ok=True)
        self.log = logging.getLogger(f"trim.{data}")
        self.log.propagate = False
        self.log.setLevel(logging.INFO)
        self.log_handler = logging.handlers.RotatingFileHandler(
            data / "trim.log", maxBytes=1_000_000, backupCount=1, encoding="utf-8"
        )
        self.log.addHandler(self.log_handler)
        try:  # only a failed bind means "port taken"; the folder and log above fail as themselves
            self.server_bind()
            self.server_activate()
        except OSError as e:
            self.server_close()
            raise PortTaken from e
        self.touch()

    def touch(self):
        with self.timer_lock:  # parallel handlers must not orphan a timer that would shut the server down later
            if self.timer:
                self.timer.cancel()
            self.timer = threading.Timer(self.idle, self.shutdown)
            self.timer.daemon = True
            self.timer.start()

    def trim(self, body):
        """The /hook answer for one request body; empty on any failure, so Claude keeps the original."""
        try:
            req = json.loads(body)
            tool, counts = req["tool_name"], []

            def trim_text(tool, text):
                new, before, after = self.trim_text(tool, text)
                if new != text:
                    counts.append((before, after))
                return new

            out = trim.walk(tool, req["tool_response"], trim_text)
            if out is None:
                return b""
            self.log.info(
                json.dumps(
                    {
                        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "tool": tool,
                        "before": sum(b for b, _ in counts),
                        "after": sum(a for _, a in counts),
                    }
                )
            )
            return json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedToolOutput": out}}).encode()
        except Exception:
            return b""

    def run(self):
        try:
            self.serve_forever()
        finally:
            with self.timer_lock:
                self.timer.cancel()
            with self.compress_lock:  # an in-flight trim finishes first
                self.server_close()
                self.log.removeHandler(self.log_handler)
                self.log_handler.close()


def make_server(port, data, lock_hash, idle=1800, trim_text=None):
    return TrimServer(port, data, lock_hash, idle, trim_text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--lock-hash", required=True)
    parser.add_argument("--idle", type=float, default=1800)
    args = parser.parse_args()
    try:
        srv = make_server(args.port, args.data, args.lock_hash, args.idle)
    except PortTaken:
        sys.exit(PORT_TAKEN)
    srv.run()


if __name__ == "__main__":
    main()
