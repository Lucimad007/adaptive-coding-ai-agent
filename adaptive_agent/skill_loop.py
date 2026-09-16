"""Patchline traces → pending skill draft → Skill Box (no LangGraph interrupt)."""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any, Callable

from adaptive_agent.induction import induce_proposal
from adaptive_agent.memory import DEFAULT_DB, Episode, Memory
from adaptive_agent.review import apply_decision
from adaptive_agent.skills import Skill, SkillBox

MAX_TRACE_EPISODES = 8
SKILL_BODY_CAP = 6_000

def next_skill_version(box: SkillBox, name: str) -> int:
    versions = [s.version for s in box.all_skills() if s.name == name]
    return (max(versions) if versions else 0) + 1


def slug_skill_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug or "untitled-skill"


def propose_pending_skill(
    *,
    name: str,
    body: str,
    rationale: str = "",
    db_path: Path | str | None = None,
    version: int | None = None,
) -> dict[str, Any]:
    box = SkillBox(db_path or DEFAULT_DB)
    slug = slug_skill_name(name)
    ver = int(version) if version else next_skill_version(box, slug)
    skill = Skill(name=slug, version=ver, status="pending", body=str(body or "").strip(), review_reason=rationale or None)
    box.upsert(skill)
    return {
        "type": "skill",
        "name": skill.name,
        "version": skill.version,
        "body": skill.body,
        "rationale": str(rationale or ""),
        "status": "pending",
        "db_path": str(box.db_path),
    }


def wait_for_skill_review(
    *,
    name: str,
    version: int,
    db_path: Path | str | None = None,
    timeout: float = 300,
    interval: float = 0.4,
) -> str:
    box = SkillBox(db_path or DEFAULT_DB)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        skill = box.get(name, int(version))
        if skill is None:
            return "missing"
        if skill.status != "pending":
            return skill.status
        time.sleep(interval)
    return "timeout"


def coding_topic(workspace: Path) -> str:
    return f"coding:{workspace.resolve().name}"


def tool_result_failed(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    return (
        t.startswith("error:")
        or "traceback" in t
        or "not found" in t
        or "exit code" in t
        or t.startswith("old text not found")
    )


def should_induce(*, failure_count: int, has_pending: bool) -> bool:
    return failure_count >= 1 and not has_pending


def retrieved_skills_block(box: SkillBox, prompt: str, *, k: int = 2) -> str:
    hits = box.search(prompt, k=k)
    parts: list[str] = []
    for skill, score in hits:
        if score <= 0:
            continue
        body = skill.body[:SKILL_BODY_CAP]
        parts.append(f"### {skill.name} v{skill.version}\n{body}")
    if not parts:
        return ""
    return "## Retrieved skills\n" + "\n\n".join(parts)


def record_run_episode(
    mem: Memory,
    *,
    workspace: Path,
    task: str,
    tool_calls: list[dict],
    failed: bool,
    error: str | None = None,
) -> int:
    return mem.add_episode(
        topic=coding_topic(workspace),
        task=task,
        outcome="failure" if failed else "success",
        error=error if failed else None,
        fix=None,
        tool_calls=tool_calls,
    )


def record_undo_episode(
    mem: Memory,
    *,
    workspace: Path,
    path: str,
    task: str = "",
) -> int:
    rel = path.replace("\\", "/")
    return mem.add_episode(
        topic=coding_topic(workspace),
        task=task or f"undo {rel}",
        outcome="failure",
        error=f"user undid {rel}",
        fix="reverted file",
        tool_calls=[{"name": "undo_diff", "args": {"path": rel}}],
    )


def maybe_induce(
    mem: Memory,
    box: SkillBox,
    *,
    topic: str,
    prompt: str,
    induce_fn: Callable[..., Any] | None = None,
) -> dict[str, Any] | None:
    if box.pending():
        return None
    fails = [e for e in mem.episodes_for_topic(topic) if e.outcome == "failure"]
    if not should_induce(failure_count=len(fails), has_pending=False):
        return None
    box.seed_from_files()
    hits = box.search(prompt, k=1)
    current = hits[0][0] if hits and hits[0][1] > 0 else None
    recent: list[Episode] = fails[-MAX_TRACE_EPISODES:]
    fn = induce_fn or induce_proposal
    proposal = fn(topic, recent, current)
    name = getattr(proposal, "name", None) or (proposal.get("name") if isinstance(proposal, dict) else None)
    version = getattr(proposal, "version", None) or (proposal.get("version") if isinstance(proposal, dict) else 1)
    body = getattr(proposal, "body", None) or (proposal.get("body") if isinstance(proposal, dict) else "")
    rationale = getattr(proposal, "rationale", None) or (
        proposal.get("rationale") if isinstance(proposal, dict) else ""
    )
    skill = Skill(name=str(name), version=int(version), status="pending", body=str(body))
    box.upsert(skill)
    return {
        "type": "skill",
        "name": skill.name,
        "version": skill.version,
        "body": skill.body,
        "rationale": str(rationale or ""),
        "status": "pending",
    }


def review_skill(box: SkillBox, *, name: str, version: int, approve: bool, reason: str = "") -> dict[str, Any]:
    skill = box.get(name, version)
    if skill is None:
        return {"ok": False, "error": "skill not found"}
    applied = apply_decision(box, skill, approve=approve, reason=reason)
    return {
        "ok": True,
        "name": applied.name,
        "version": applied.version,
        "status": applied.status,
    }


def pending_payloads(box: SkillBox) -> list[dict[str, Any]]:
    return [
        {
            "type": "skill",
            "name": s.name,
            "version": s.version,
            "body": s.body,
            "rationale": s.review_reason or "",
            "status": s.status,
        }
        for s in box.pending()
    ]


def handle_skills_cmd(msg: dict[str, Any], db_path: Path | str | None = None) -> dict[str, Any]:
    db = Path(msg.get("db_path") or db_path or DEFAULT_DB)
    mem = Memory(db)
    box = SkillBox(db)
    action = str(msg.get("action") or "")
    workspace = Path(msg.get("workspace") or ".")
    if action == "trace":
        eid = record_undo_episode(mem, workspace=workspace, path=str(msg.get("path") or ""), task=str(msg.get("task") or ""))
        event = None
        try:
            event = maybe_induce(mem, box, topic=coding_topic(workspace), prompt=str(msg.get("task") or msg.get("path") or "code"))
        except Exception as exc:
            return {"ok": True, "id": eid, "induce_error": str(exc)}
        return {"ok": True, "id": eid, "skill": event}
    if action == "review":
        return review_skill(
            box,
            name=str(msg.get("name") or ""),
            version=int(msg.get("version") or 1),
            approve=bool(msg.get("approve")),
            reason=str(msg.get("reason") or ""),
        )
    if action == "pending":
        return {"ok": True, "skills": pending_payloads(box)}
    return {"ok": False, "error": f"unknown action {action}"}
