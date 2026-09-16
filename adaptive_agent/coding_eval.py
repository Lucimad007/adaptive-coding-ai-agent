"""Copy the sample fixture, run the coding worker, score retrieval + pytest + diffs."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from adaptive_agent.code_graph import build_code_graph
from adaptive_agent.graph_retrieve import graph_retrieve
from adaptive_agent.memory import ROOT

SAMPLE = ROOT / "fixtures" / "sample_codebase"
SKIP_DIRS = {".git", ".venv", "__pycache__", "node_modules"}

TASKS = [
    {
        "id": "clip_count",
        "prompt": (
            "In feed/player.py add clip_count(clips) that returns len(clips) or 0 if clips is falsy. "
            "Add a pytest in tests/test_feed.py: clip_count(['a','b']) == 2. Run pytest. "
            "Do not rewrite unrelated files."
        ),
        "expect_hits": ["autoplay", "player"],
        "must_touch": ["feed/player.py", "tests/test_feed.py"],
        "must_not_touch": ["app.py", "feed/ranker.py"],
        "must_contain": {"feed/player.py": "def clip_count"},
    },
    {
        "id": "fetch_clip_doc",
        "prompt": (
            "Add a one-line docstring to fetch_clip in app.py explaining it returns demo clip ids. "
            "Do not change get_feed. Run pytest."
        ),
        "expect_hits": ["fetch_clip", "app.py"],
        "must_touch": ["app.py"],
        "must_not_touch": ["feed/player.py"],
        "must_contain": {"app.py": '"""'},
    },
]


@dataclass
class TaskScore:
    id: str
    retrieval_ok: bool
    pytest_ok: bool
    files_ok: bool
    content_ok: bool
    tools: list[str]
    changed: list[str]
    hits: list[str]
    passed: bool
    notes: str


def snapshot(root: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(p in SKIP_DIRS for p in path.parts):
            continue
        rel = path.relative_to(root).as_posix()
        try:
            files[rel] = path.read_text(encoding="utf-8")
        except OSError:
            continue
    return files


def changed_files(before: dict[str, str], after: dict[str, str]) -> list[str]:
    keys = set(before) | set(after)
    return sorted(k for k in keys if before.get(k) != after.get(k))


def copy_fixture(dest: Path) -> Path:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(SAMPLE, dest)
    return dest


def retrieval_hits(workspace: Path, prompt: str) -> list[str]:
    graph = build_code_graph(workspace)
    result = graph_retrieve(graph, prompt, k=6, n_anchors=1)
    return [n.id for n, _ in result["hits"]]


def hits_ok(hits: list[str], expect: list[str]) -> bool:
    blob = " ".join(hits).lower()
    return any(token.lower() in blob for token in expect)


def run_pytest(workspace: Path) -> tuple[bool, str]:
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "-q"],
        cwd=workspace,
        capture_output=True,
        text=True,
        timeout=60,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode == 0, out[-4000:]


def run_worker(workspace: Path, prompt: str, timeout: int = 180) -> dict:
    payload = json.dumps({"type": "start_run", "workspace": str(workspace), "prompt": prompt})
    proc = subprocess.run(
        [sys.executable, "-m", "adaptive_agent.harness_worker", "run"],
        cwd=ROOT,
        input=payload + "\n",
        capture_output=True,
        text=True,
        timeout=timeout,
        env={**os.environ},
    )
    events: list[dict] = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    tools = [e.get("name") for e in events if e.get("type") == "tool"]
    graph = next((e for e in events if e.get("type") == "graph"), {})
    return {
        "ok": proc.returncode == 0 and any(e.get("type") == "done" for e in events),
        "stderr": (proc.stderr or "")[-2000:],
        "tools": [t for t in tools if t],
        "hits": [h.get("id") for h in graph.get("hits") or [] if isinstance(h, dict)],
        "walkIds": graph.get("walkIds") or [],
        "events": events,
    }


def score_task(task: dict, *, workspace: Path, worker: dict | None, before: dict[str, str], after: dict[str, str]) -> TaskScore:
    if worker:
        hits = list(worker.get("walkIds") or []) or list(worker.get("hits") or [])
    else:
        hits = []
    if not hits:
        hits = retrieval_hits(workspace, task["prompt"])
    retrieval = hits_ok(list(hits), task["expect_hits"])
    py_ok, py_out = run_pytest(workspace)
    changed = changed_files(before, after)
    files = all(p in changed for p in task["must_touch"]) and not any(p in changed for p in task.get("must_not_touch") or [])
    content = True
    for rel, needle in (task.get("must_contain") or {}).items():
        text = after.get(rel, "")
        if needle not in text:
            content = False
    notes = []
    if worker and not worker.get("ok"):
        notes.append("worker failed")
        notes.append(worker.get("stderr") or "")
    if not py_ok:
        notes.append(py_out)
    passed = retrieval and py_ok and files and content
    if worker is None:
        passed = retrieval
        files = True
        content = True
        py_ok = True
        notes = ["offline: retrieval only"]
    return TaskScore(
        id=task["id"],
        retrieval_ok=retrieval,
        pytest_ok=py_ok,
        files_ok=files,
        content_ok=content,
        tools=list(worker.get("tools") or []) if worker else [],
        changed=changed,
        hits=list(hits),
        passed=passed,
        notes="\n".join(notes).strip()[:1500],
    )


def run_eval(*, live: bool, task_id: str | None = None) -> list[TaskScore]:
    selected = [t for t in TASKS if not task_id or t["id"] == task_id]
    scores: list[TaskScore] = []
    for task in selected:
        dest = ROOT / "data" / "eval" / task["id"]
        copy_fixture(dest)
        before = snapshot(dest)
        if live:
            worker = run_worker(dest, task["prompt"])
            after = snapshot(dest)
            scores.append(score_task(task, workspace=dest, worker=worker, before=before, after=after))
        else:
            scores.append(score_task(task, workspace=dest, worker=None, before=before, after=before))
    return scores


def main() -> None:
    parser = argparse.ArgumentParser(description="Coding-agent eval on fixtures/sample_codebase")
    parser.add_argument("--live", action="store_true", help="Call the LLM worker (needs OPENCODE_API_KEY)")
    parser.add_argument("--task", default="", help="Run one task id (clip_count | fetch_clip_doc)")
    args = parser.parse_args()
    scores = run_eval(live=args.live, task_id=args.task or None)
    payload = [asdict(s) for s in scores]
    print(json.dumps({"live": args.live, "pass": sum(s.passed for s in scores), "n": len(scores), "tasks": payload}, indent=2))
    if args.live and not all(s.passed for s in scores):
        raise SystemExit(1)
    if not args.live and not all(s.retrieval_ok for s in scores):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
