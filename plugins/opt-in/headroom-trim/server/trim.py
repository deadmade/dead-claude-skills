"""The trim server's core: rebuild a tool_response with each string trimmed, and trim one string with headroom."""

from headroom import compress
from headroom.compress import CompressConfig
from headroom.tokenizers import get_tokenizer

CONFIG = CompressConfig(protect_recent=0, kompress_model="disabled")
MODEL = "claude-sonnet-4-5-20250929"  # compress()'s default model, so the counts match what compress() uses


def walk(tool, response, trim_text):
    """Return response with every string replaced by trim_text(tool, s), or None when no string changed."""
    changed = False

    def go(node):
        nonlocal changed
        if isinstance(node, str):
            new = trim_text(tool, node)
            changed = changed or new != node
            return new
        if isinstance(node, dict):
            if node.get("type") == "image":  # Claude Code rejects a changed base64 payload
                return node
            return {k: go(v) for k, v in node.items()}
        if isinstance(node, list):
            return [go(v) for v in node]
        return node

    out = go(response)
    return out if changed else None


def headroom_text(tool, text):
    """Trim one tool result with headroom; return (text, tokens before, tokens after) of the text alone."""
    messages = [
        {"role": "user", "content": "Continue the task."},
        {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": tool, "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": text}]},
    ]
    content = compress(messages, model=MODEL, config=CONFIG).messages[-1]["content"][0]["content"]
    if not isinstance(content, str):  # headroom may hand back blocks; keep their text
        content = "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    counter = get_tokenizer(MODEL)
    return content, counter.count_text(text), counter.count_text(content)
