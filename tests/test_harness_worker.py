from pathlib import Path
import json
import subprocess
import sys

import pytest

from adaptive_agent.harness_worker import _chunk_text, _safe, _sanitize_str, make_tools


def test_chunk_text_plain_and_blocks():
    class Msg:
        def __init__(self, content):
            self.content = content

    assert _chunk_text(Msg("hi")) == "hi"
    assert _chunk_text(Msg([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}])) == "ab"


def test_sanitize_str_drops_lone_surrogates():
    assert "\ufffd" in _sanitize_str("ok\udc9dbad")


def test_worker_rejects_traversal(tmp_path: Path):
    with pytest.raises(ValueError):
        _safe(tmp_path, "../secret")


def test_worker_allows_nested(tmp_path: Path):
    p = _safe(tmp_path, "a/b.txt")
    assert tmp_path in p.parents or p.parent == tmp_path


def test_worker_graph_json():
    root = Path(__file__).resolve().parents[1]
    sample = root / "fixtures" / "sample_codebase"
    proc = subprocess.run(
        [sys.executable, "-m", "adaptive_agent.harness_worker", "graph", "--workspace", str(sample)],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(proc.stdout)
    assert data["nodes"]
    assert "edges" in data


def test_apply_patch_roundtrip(tmp_path: Path):
    target = tmp_path / "a.py"
    target.write_text("hello world\n", encoding="utf-8")
    tools = {t.name: t for t in make_tools(tmp_path)}
    out = tools["apply_patch"].invoke({"path": "a.py", "old": "world", "new": "there"})
    assert "patched" in out
    assert target.read_text(encoding="utf-8") == "hello there\n"


def test_read_missing_file_returns_error(tmp_path: Path):
    tools = {t.name: t for t in make_tools(tmp_path)}
    out = tools["read_file"].invoke({"path": "README.md"})
    assert "not found" in out.lower()


def test_user_message_plain_and_image():
    from langchain_core.messages import HumanMessage
    from adaptive_agent.harness_worker import _user_message

    plain = _user_message("hello", [])
    assert isinstance(plain, HumanMessage)
    assert plain.content == "hello"
    vision = _user_message("look", [{"mime": "image/jpeg", "data": "abc"}])
    assert isinstance(vision.content, list)
    assert vision.content[0]["type"] == "text"
    assert vision.content[1]["type"] == "image_url"
    assert "base64,abc" in vision.content[1]["image_url"]["url"]


def test_resolve_images_from_path(tmp_path: Path):
    from adaptive_agent.harness_worker import _resolve_images, _user_message

    p = tmp_path / "shot.jpg"
    p.write_bytes(b"\xff\xd8\xff")
    loaded = _resolve_images([{"mime": "image/jpeg", "path": str(p)}])
    assert loaded and loaded[0]["data"]
    msg = _user_message("see this", [{"path": str(p), "mime": "image/jpeg"}])
    assert isinstance(msg.content, list)
    assert msg.content[1]["type"] == "image_url"


def test_create_plan_tool(tmp_path: Path):
    tools = {t.name: t for t in make_tools(tmp_path, wait_plan=False)}
    out = tools["create_plan"].invoke(
        {"title": "Add auth", "markdown": "## Files\n- app.py\n", "todos": '[{"content":"wire login"}]'}
    )
    assert "Build" in out


def test_ask_questions_without_wait(tmp_path: Path):
    tools = {t.name: t for t in make_tools(tmp_path, wait_plan=False)}
    out = tools["ask_clarifying_questions"].invoke(
        {"questions": '[{"id":"1","prompt":"API or UI?","options":["API","UI"]}]'}
    )
    assert "waiting" in out


def test_list_dir_empty(tmp_path: Path):
    tools = {t.name: t for t in make_tools(tmp_path)}
    out = tools["list_dir"].invoke({"path": "."})
    assert "empty" in out.lower()
