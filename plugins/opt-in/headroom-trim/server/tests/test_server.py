import concurrent.futures
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import server

SERVER_DIR = Path(__file__).resolve().parent.parent
SERVER_PY = SERVER_DIR / "server.py"
FIXTURES = SERVER_DIR / "tests" / "fixtures"
LOCK = "ab12"
VERSION = "0.6.0"


def payload(name="Bash"):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def long_log():
    return "\n".join(
        f"2026-10-30T12:{i // 60:02d}:{i % 60:02d}.000Z INFO worker-{i % 4} handled request {i} in {i % 37} ms"
        for i in range(600)
    )


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(port, path, body=None, method=None, timeout=10):
    data = body if isinstance(body, bytes) else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


class Running:
    """A server on an ephemeral port in a thread, with its own data folder."""

    def __init__(self, trim_text=None, idle=1800):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"  # missing on purpose: the server creates it
        self.server = server.make_server(0, self.data, LOCK, idle=idle, trim_text=trim_text, version=VERSION)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.run)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.thread.join(10)
        self.tmp.cleanup()


class HookTest(unittest.TestCase):
    def running(self, trim_text=None):
        r = Running(trim_text)
        self.addCleanup(r.stop)
        return r

    def log_lines(self, r):
        return [json.loads(line) for line in (r.data / "trim.log").read_text(encoding="utf-8").splitlines()]

    def test_hook_trims(self):
        r = self.running()
        body = payload()
        body["tool_response"]["stdout"] = long_log()
        status, out = request(r.port, "/hook", body)
        self.assertEqual(status, 200)
        result = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(result["hookEventName"], "PostToolUse")
        new = result["updatedToolOutput"]
        self.assertEqual(new.keys(), body["tool_response"].keys())
        self.assertLess(len(new["stdout"]), len(body["tool_response"]["stdout"]))

    def test_hook_unchanged_is_empty(self):
        r = self.running()
        status, out = request(r.port, "/hook", payload())
        self.assertEqual((status, out), (200, b""))

    def test_hook_bad_json_is_empty(self):
        r = self.running()
        self.assertEqual(request(r.port, "/hook", b"{not json"), (200, b""))
        self.assertEqual(request(r.port, "/hook", {"tool_name": "Bash"}), (200, b""))

    def test_hook_exception_is_empty(self):
        def boom(tool, text):
            raise RuntimeError("headroom broke")

        r = self.running(boom)
        self.assertEqual(request(r.port, "/hook", payload()), (200, b""))

    def test_parallel_requests(self):
        r = self.running()
        big = payload()
        big["tool_response"]["stdout"] = long_log()
        bodies = [big if i % 2 else payload() for i in range(8)]  # half really trim, so compress() calls contend
        start = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda b: request(r.port, "/hook", b, timeout=5), bodies))
        self.assertTrue(all(status == 200 for status, _ in results))
        self.assertTrue(all(b"updatedToolOutput" in out for (_, out), b in zip(results, bodies) if b is big))
        self.assertLess(time.monotonic() - start, 5)

    def test_touch_keeps_one_timer(self):
        r = self.running()
        before = sum(t.is_alive() for t in threading.enumerate() if isinstance(t, threading.Timer))
        with concurrent.futures.ThreadPoolExecutor(16) as pool:
            list(pool.map(lambda _: [r.server.touch() for _ in range(200)], range(16)))
        time.sleep(0.2)  # cancelled timers have left by now; an orphan would still be waiting
        alive = sum(t.is_alive() for t in threading.enumerate() if isinstance(t, threading.Timer))
        self.assertEqual(alive, before)

    def raw(self, port, head):
        with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
            s.sendall(head)
            s.settimeout(5)
            data = b""
            while chunk := s.recv(4096):
                data += chunk
        return data

    def test_bad_content_length_is_empty(self):
        r = self.running()
        out = self.raw(r.port, b"POST /hook HTTP/1.0\r\ncontent-length: abc\r\n\r\n")
        self.assertTrue(out.startswith(b"HTTP/1.0 200"), out)
        self.assertTrue(out.endswith(b"\r\n\r\n"), out)

    def test_stalled_client_gets_empty_answer(self):
        server.Handler.timeout = 0.5
        self.addCleanup(setattr, server.Handler, "timeout", 5)
        r = self.running()
        start = time.monotonic()
        out = self.raw(r.port, b"POST /hook HTTP/1.0\r\ncontent-length: 100\r\n\r\n")  # body never comes
        self.assertTrue(out.startswith(b"HTTP/1.0 200"), out)
        self.assertLess(time.monotonic() - start, 3)

    def test_health_reports_identity_and_version(self):
        r = self.running()
        status, out = request(r.port, "/health")
        self.assertEqual((status, json.loads(out)), (200, {"ok": True, "lock": LOCK, "version": VERSION}))

    def test_queued_past_the_deadline_is_empty(self):
        def slow(tool, text):
            time.sleep(0.6)
            return text.upper(), 2, 1

        r = self.running(slow)
        r.server.queue_deadline = 0.3  # 4 s in use; a hook waiting longer would outlive Claude Code's 5 s
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            first = pool.submit(request, r.port, "/hook", payload())
            time.sleep(0.1)
            second = pool.submit(request, r.port, "/hook", payload())
            results = [first.result(5), second.result(5)]
        self.assertIn(b"updatedToolOutput", results[0][1])
        self.assertEqual(results[1], (200, b""))

    def test_queued_within_the_deadline_is_trimmed(self):
        def slow(tool, text):
            time.sleep(0.2)
            return text.upper(), 2, 1

        r = self.running(slow)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda _: request(r.port, "/hook", payload()), range(2)))
        self.assertTrue(all(b"updatedToolOutput" in out for _, out in results))

    def test_log_line(self):
        r = self.running()
        body = payload()
        body["tool_response"]["stdout"] = long_log()
        request(r.port, "/hook", body)
        (line,) = self.log_lines(r)
        self.assertEqual(set(line), {"time", "tool", "before", "after"})
        self.assertEqual(line["tool"], "Bash")
        self.assertGreater(line["before"], line["after"])
        self.assertNotIn("worker-", json.dumps(line))

    def test_no_log_when_unchanged(self):
        r = self.running()
        request(r.port, "/hook", payload())
        self.assertFalse((r.data / "trim.log").exists() and (r.data / "trim.log").read_text())


class ShutdownTest(unittest.TestCase):
    def test_shutdown_stops(self):
        r = Running()
        self.addCleanup(r.tmp.cleanup)
        self.assertEqual(request(r.port, "/shutdown", b"")[0], 200)
        r.thread.join(5)
        self.assertFalse(r.thread.is_alive())
        with self.assertRaises(OSError):
            request(r.port, "/health", timeout=2)

    def test_shutdown_waits_for_inflight(self):
        def slow(tool, text):
            time.sleep(0.5)
            return text.upper(), 2, 1

        r = Running(slow)
        self.addCleanup(r.tmp.cleanup)
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            inflight = pool.submit(request, r.port, "/hook", payload())
            time.sleep(0.2)
            request(r.port, "/shutdown", b"")
            status, out = inflight.result(5)
        self.assertEqual(status, 200)
        self.assertIn("updatedToolOutput", json.loads(out)["hookSpecificOutput"])
        r.thread.join(5)
        self.assertFalse(r.thread.is_alive())
        lines = (r.data / "trim.log").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 1)


def spawn(port, data, *extra, env=None):
    return subprocess.Popen(
        [sys.executable, "-X", "utf8", str(SERVER_PY), "--port", str(port), "--data", str(data), "--lock-hash", LOCK, "--version", VERSION, *extra],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env=env,
    )


def wait_healthy(port, proc, deadline=60):
    end = time.monotonic() + deadline
    while time.monotonic() < end:
        if proc.poll() is not None:
            raise AssertionError(f"server exited {proc.returncode}: {proc.stderr.read().decode(errors='replace')}")
        try:
            return request(port, "/health", timeout=1)
        except OSError:
            time.sleep(0.1)
    raise AssertionError("server never became healthy")


class ProcessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / "data"

    def start(self, port, *extra, env=None):
        proc = spawn(port, self.data, *extra, env=env)
        self.addCleanup(lambda: (proc.kill(), proc.wait(), proc.stderr.close()))
        return proc

    def test_server_process_has_no_network(self):
        data = str(self.data)
        code = (
            "import os, socket, sys\n"
            f"sys.path.insert(0, {str(SERVER_DIR)!r})\n"
            f"sys.argv = ['server.py', {'--data=' + data!r}]\n"
            "import server\n"
            "for call in (lambda: socket.create_connection(('1.1.1.1', 443), timeout=1),\n"
            "             lambda: socket.getaddrinfo('example.com', 443)):\n"
            "    try:\n        call()\n    except PermissionError:\n        continue\n"
            "    sys.exit('not blocked')\n"
            "want = {'HEADROOM_OFFLINE': '1', 'HEADROOM_BEACON': 'off', 'HEADROOM_TELEMETRY': 'off', 'DO_NOT_TRACK': '1',\n"
            "        'HEADROOM_UPDATE_CHECK': 'off', 'HF_HUB_OFFLINE': '1', 'HEADROOM_CCR_BACKEND': 'memory'}\n"
            f"want['HEADROOM_WORKSPACE_DIR'] = os.path.join({data!r}, 'headroom')\n"
            f"want['TIKTOKEN_CACHE_DIR'] = os.path.join({data!r}, 'tiktoken')\n"
            "assert all(os.environ.get(k) == v for k, v in want.items()), os.environ\n"
            "import headroom.telemetry.session as s\n"
            "assert s.post_session_event({}) is None and s._post_blocking({}) is None\n"
            "print('ok')\n"
        )
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HEADROOM_", "HF_"))}
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "ok"), r.stderr)

    def test_real_token_counter_from_data_cache(self):
        empty_temp = str(Path(self.tmp.name) / "temp")  # so tiktoken's default %TEMP% cache can't stand in for ours
        Path(empty_temp).mkdir()
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HEADROOM_", "TIKTOKEN_"))}
        env.update(TEMP=empty_temp, TMP=empty_temp, TMPDIR=empty_temp)
        cache = self.data / "tiktoken"
        # Fill the cache the way the installer will: a plain process with network access, outside the guard.
        fill = subprocess.run(
            [sys.executable, "-c", "import tiktoken; tiktoken.get_encoding('o200k_base')"],
            capture_output=True, text=True, timeout=120, env={**env, "TIKTOKEN_CACHE_DIR": str(cache)},
        )
        self.assertEqual(fill.returncode, 0, fill.stderr)
        code = (
            "import sys\n"
            f"sys.path.insert(0, {str(SERVER_DIR)!r})\n"
            f"sys.argv = ['server.py', '--data', {str(self.data)!r}]\n"
            "import server, trim\n"
            "from headroom.tokenizers import get_tokenizer\n"
            "print(type(get_tokenizer(trim.MODEL)).__name__)\n"
        )
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(r.stdout.strip(), "TiktokenCounter", r.stderr)

    def test_unusable_data_dir_is_not_exit_75(self):
        self.data.parent.mkdir(parents=True, exist_ok=True)
        self.data.write_text("a file, not a folder")
        proc = self.start(free_port())
        proc.wait(30)
        self.assertNotIn(proc.returncode, (0, 75))

    def test_idle_exit(self):
        port = free_port()
        proc = self.start(port, "--idle", "1")
        wait_healthy(port, proc)
        proc.wait(3)
        self.assertEqual(proc.returncode, 0)

    def test_port_taken_exits_75(self):
        with socket.socket() as held:
            held.bind(("127.0.0.1", 0))
            held.listen()
            proc = self.start(held.getsockname()[1])
            proc.wait(2)
        self.assertEqual(proc.returncode, 75)

    @unittest.skipIf(sys.platform == "win32", "Linux only: Windows keeps allow_reuse_address off")
    def test_rebind_after_shutdown(self):
        port = free_port()
        proc = self.start(port)
        wait_healthy(port, proc)
        request(port, "/hook", payload())
        request(port, "/shutdown", b"")
        proc.wait(5)
        proc2 = self.start(port)
        wait_healthy(port, proc2)

    def test_no_files_outside_data(self):
        home = Path(self.tmp.name) / "home"
        home.mkdir()
        env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home)}
        port = free_port()
        proc = self.start(port, env=env)
        wait_healthy(port, proc)
        body = payload()
        body["tool_response"]["stdout"] = long_log()
        status, out = request(port, "/hook", body)
        self.assertIn(b"updatedToolOutput", out)
        request(port, "/shutdown", b"")
        proc.wait(5)
        self.assertEqual(list(home.rglob("*")), [])
        self.assertTrue((self.data / "trim.log").exists())


if __name__ == "__main__":
    unittest.main()
