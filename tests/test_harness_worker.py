from pathlib import Path
import json
import subprocess
import sys

import pytest

from adaptive_agent.harness_worker import _safe, make_tools


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
