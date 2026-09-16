from pathlib import Path

from adaptive_agent.memory import Memory
from adaptive_agent.review import apply_decision
from adaptive_agent.skill_loop import (
    coding_topic,
    handle_skills_cmd,
    maybe_induce,
    record_run_episode,
    retrieved_skills_block,
    should_induce,
    tool_result_failed,
)
from adaptive_agent.skills import Skill, SkillBox


def test_tool_result_failed():
    assert tool_result_failed("error: missing")
    assert tool_result_failed("old text not found")
    assert not tool_result_failed("wrote a.py")


def test_should_induce_needs_a_failure_and_no_pending():
    assert not should_induce(failure_count=0, has_pending=False)
    assert should_induce(failure_count=1, has_pending=False)
    assert not should_induce(failure_count=5, has_pending=True)


def test_record_run_episode(tmp_db, tmp_path: Path):
    mem = Memory(tmp_db)
    record_run_episode(
        mem,
        workspace=tmp_path,
        task="edit foo",
        tool_calls=[{"name": "read_file", "args": {"path": "x"}}],
        failed=True,
        error="error: x not found",
    )
    rows = mem.episodes_for_topic(coding_topic(tmp_path))
    assert len(rows) == 1
    assert rows[0].outcome == "failure"
    assert rows[0].tool_calls[0]["name"] == "read_file"


def test_maybe_induce_skips_with_no_failures(tmp_db, tmp_path: Path):
    mem = Memory(tmp_db)
    box = SkillBox(tmp_db)
    called = {"n": 0}

    def fake_induce(*_a, **_k):
        called["n"] += 1
        raise AssertionError("should not induce")

    out = maybe_induce(mem, box, topic=coding_topic(tmp_path), prompt="t", induce_fn=fake_induce)
    assert out is None
    assert called["n"] == 0


def test_maybe_induce_drafts_pending_after_one_failure(tmp_db, tmp_path: Path):
    mem = Memory(tmp_db)
    box = SkillBox(tmp_db)
    topic = coding_topic(tmp_path)
    record_run_episode(mem, workspace=tmp_path, task="t1", tool_calls=[], failed=True, error="e1")

    class Prop:
        name = "fix-missing-file"
        version = 1
        body = "Always list_dir then write_file if missing."
        rationale = "two not-found traces"

    out = maybe_induce(mem, box, topic=topic, prompt="create file", induce_fn=lambda *a, **k: Prop())
    assert out is not None
    assert out["name"] == "fix-missing-file"
    assert box.pending()[0].body.startswith("Always list_dir")
    again = maybe_induce(mem, box, topic=topic, prompt="create file", induce_fn=lambda *a, **k: Prop())
    assert again is None


def test_approved_skill_is_retrieved(tmp_db):
    box = SkillBox(tmp_db)
    pending = Skill(name="write-missing-files", version=1, status="pending", body="If a file is missing, call write_file.")
    box.upsert(pending)
    apply_decision(box, pending, approve=True, reason="from traces")
    hits = box.search("the file is missing write it", k=1)
    assert hits
    assert hits[0][0].status == "active"
    block = retrieved_skills_block(box, "missing file write_file")
    assert "write_file" in block


def test_propose_pending_skill(tmp_db):
    from adaptive_agent.skill_loop import propose_pending_skill

    ev = propose_pending_skill(name="Always Lint", body="Run ruff before commit.", rationale="user asked", db_path=tmp_db)
    assert ev["status"] == "pending"
    assert ev["name"] == "always-lint"
    box = SkillBox(tmp_db)
    assert box.pending()[0].body.startswith("Run ruff")


def test_wait_for_skill_review_sees_approve(tmp_db):
    from adaptive_agent.skill_loop import propose_pending_skill, wait_for_skill_review

    ev = propose_pending_skill(name="wait-me", body="x", db_path=tmp_db)
    box = SkillBox(tmp_db)
    skill = box.get(ev["name"], ev["version"])
    apply_decision(box, skill, approve=True, reason="ok")
    assert wait_for_skill_review(name=ev["name"], version=ev["version"], db_path=tmp_db, timeout=1) == "active"


def test_handle_skills_review_and_pending(tmp_db):
    box = SkillBox(tmp_db)
    box.upsert(Skill(name="demo", version=1, status="pending", body="steps"))
    listed = handle_skills_cmd({"action": "pending", "db_path": str(tmp_db)})
    assert listed["skills"][0]["name"] == "demo"
    reviewed = handle_skills_cmd(
        {"action": "review", "db_path": str(tmp_db), "name": "demo", "version": 1, "approve": True, "reason": "ok"}
    )
    assert reviewed["status"] == "active"
