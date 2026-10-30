import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent

# Each blocked call runs in its own guarded subprocess; the allowed ones (loopback) must not raise.
BLOCKED = {
    "getaddrinfo": "socket.getaddrinfo('example.com', 443)",
    "connect": "socket.create_connection(('1.1.1.1', 443), timeout=1)",
    "sendto": "socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b'x', ('1.1.1.1', 53))",
    "sendmsg": "socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendmsg([b'x'], [], 0, ('1.1.1.1', 53))",
    "gethostbyname": "socket.gethostbyname('example.com')",
    "gethostbyname_ex": "socket.gethostbyname_ex('example.com')",
    "gethostbyaddr": "socket.gethostbyaddr('1.1.1.1')",
    "getnameinfo": "socket.getnameinfo(('1.1.1.1', 443), 0)",
}
ALLOWED = [
    "socket.create_connection(listener.getsockname()).close()",
    "udp.sendto(b'x', listener.getsockname())",
    "udp.sendmsg([b'x'], [], 0, listener.getsockname())",
    "socket.gethostbyname('localhost')",
    "socket.gethostbyname_ex('127.0.0.1')",
    "socket.gethostbyaddr('127.0.0.1')",
    "socket.getnameinfo(('127.0.0.1', 80), 0)",
]

CODE = textwrap.dedent(
    """
    import socket, sys
    sys.path.insert(0, {dir!r})
    import guard
    guard.install()
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        {call}
    except PermissionError:
        print("blocked")
    except Exception as e:
        print("other", type(e).__name__)
    else:
        print("passed")
    """
)


def run(call):
    if "sendmsg" in call and sys.platform == "win32":  # socket.sendmsg doesn't exist there, so there is nothing to block
        return "unavailable"
    r = subprocess.run(
        [sys.executable, "-c", CODE.format(dir=str(SERVER_DIR), call=call)], capture_output=True, text=True, timeout=30
    )
    return r.stdout.strip()


class GuardTest(unittest.TestCase):
    def test_guard_blocks_dns_and_connect(self):
        for name, call in BLOCKED.items():
            with self.subTest(name):
                self.assertIn(run(call), ("blocked", "unavailable"))

    def test_guard_allows_loopback(self):
        for call in ALLOWED:
            with self.subTest(call):
                self.assertNotEqual(run(call), "blocked")


if __name__ == "__main__":
    unittest.main()
