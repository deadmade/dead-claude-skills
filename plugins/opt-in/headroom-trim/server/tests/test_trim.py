import base64
import copy
import json
import os
import unittest
from pathlib import Path

from trim import headroom_text, walk

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))["tool_response"]


def long_log():
    return "\n".join(
        f"2026-10-30T12:{i // 60:02d}:{i % 60:02d}.000Z INFO worker-{i % 4} handled request {i} in {i % 37} ms"
        for i in range(600)
    )


def same_shape(a, b, upper):
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(same_shape(a[k], b[k], upper) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(same_shape(x, y, upper) for x, y in zip(a, b))
    if isinstance(a, str):
        return b == a.upper()
    return type(a) is type(b) and a == b


class WalkTest(unittest.TestCase):
    def test_walk_returns_none_when_nothing_changes(self):
        self.assertIsNone(walk("Bash", fixture("Bash"), lambda t, s: s))

    def test_walk_keeps_structure(self):
        original = fixture("Bash")
        out = walk("Bash", copy.deepcopy(original), lambda t, s: s.upper())
        self.assertTrue(same_shape(original, out, True))

    def test_walk_passes_tool_name(self):
        seen = set()
        walk("Grep", fixture("Grep"), lambda t, s: seen.add(t) or s)
        self.assertEqual(seen, {"Grep"})

    def test_mcp_image_left_alone(self):
        data = base64.b64encode(os.urandom(7500)).decode()  # ~10 KB of base64
        block = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}}
        response = [{"type": "text", "text": "hi"}, block]
        out = walk("mcp__x__y", response, lambda t, s: headroom_text(t, s)[0])
        if out is not None:
            self.assertEqual(out[1]["source"]["data"], data)


class HeadroomTest(unittest.TestCase):
    def test_headroom_trims_a_long_log(self):
        text = long_log()
        out, before, after = headroom_text("Bash", text)
        self.assertLess(len(out), len(text))
        self.assertGreater(before, after)

    def test_headroom_keeps_read(self):
        text = long_log()
        self.assertEqual(headroom_text("Read", text)[0], text)


if __name__ == "__main__":
    unittest.main()
