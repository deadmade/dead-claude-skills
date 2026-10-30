import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent

CODE = textwrap.dedent(
    """
    import socket, sys
    sys.path.insert(0, {dir!r})
    import guard
    guard.install()
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    socket.create_connection(listener.getsockname()).close()  # loopback works
    for call in (lambda: socket.getaddrinfo("example.com", 443),
                 lambda: socket.create_connection(("1.1.1.1", 443), timeout=1)):
        try:
            call()
        except PermissionError:
            continue
        sys.exit("not blocked")
    print("ok")
    """
)


class GuardTest(unittest.TestCase):
    def test_guard_blocks_dns_and_connect(self):
        r = subprocess.run(
            [sys.executable, "-c", CODE.format(dir=str(SERVER_DIR))], capture_output=True, text=True, timeout=30
        )
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "ok"), r.stderr)


if __name__ == "__main__":
    unittest.main()
