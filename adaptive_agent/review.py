"""Human-in-the-loop review of pending skill proposals."""

from __future__ import annotations

from adaptive_agent.skills import Skill, SkillBox


def _safe(text: object) -> None:
    s = str(text)
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode("ascii"))


def print_diff(current: Skill | None, proposal: dict) -> None:
    _safe("\n=== Skill review ===")
    if current:
        _safe(f"Current: {current.heading}")
        _safe(current.body)
        _safe("---")
    else:
        _safe("Current: (none)")
        _safe("---")
    _safe(f"Proposed: {proposal.get('name')} v{proposal.get('version')}")
    _safe(proposal.get("body", ""))
    if proposal.get("rationale"):
        _safe(f"\nRationale: {proposal['rationale']}")


def apply_decision(box: SkillBox, skill: Skill, *, approve: bool, reason: str) -> Skill:
    skill.status = "active" if approve else "rejected"
    skill.review_reason = reason
    box.upsert(skill)
    if approve:
        box.supersede_previous(skill.name, skill.version)
    return skill
