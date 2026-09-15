"""Turn traces into a pending skill update via LangGraph + OpenCode."""

from __future__ import annotations

import json
import re
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

from adaptive_agent.llm import build_llm
from adaptive_agent.memory import Episode
from adaptive_agent.skills import Skill, SkillBox

INDUCTION_SYSTEM = """You turn agent traces into a reusable skill update.

Given a topic, the current skill (if any), and episodes with errors and fixes,
draft the next version of the skill so the agent will not repeat the same mistake.

Return JSON only with keys:
- name: kebab-case skill name
- version: integer, current version + 1 (or 1 if none)
- body: markdown skill the agent will follow next time
- rationale: short why this change
- errors_and_fixes: list of strings summarizing repeated failures and their fixes

The skill body must include concrete steps and name tools the agent should call.
If tests failed because dependencies were missing, the new skill must install
dependencies (call run_tests with install_deps=true) before running tests.
"""


class SkillProposal(BaseModel):
    name: str
    version: int
    body: str
    rationale: str
    errors_and_fixes: list[str] = Field(default_factory=list)


class InductionState(TypedDict, total=False):
    topic: str
    db_path: str
    episodes: list[dict[str, Any]]
    current_skill: dict[str, Any] | None
    proposal: dict[str, Any]
    decision: str
    reason: str
    applied: dict[str, Any]


def episodes_to_dicts(episodes: list[Episode]) -> list[dict[str, Any]]:
    return [
        {
            "id": ep.id,
            "topic": ep.topic,
            "task": ep.task,
            "outcome": ep.outcome,
            "error": ep.error,
            "fix": ep.fix,
            "tool_calls": ep.tool_calls,
        }
        for ep in episodes
    ]


def induce_proposal(
    topic: str,
    episodes: list[Episode] | list[dict[str, Any]],
    current: Skill | None,
) -> SkillProposal:
    llm = build_llm(temperature=0.1)
    current_blob = (
        f"name={current.name} version={current.version}\n{current.body}"
        if current
        else "(none)"
    )
    if episodes and isinstance(episodes[0], Episode):
        traces = json.dumps(episodes_to_dicts(episodes), indent=2)
    else:
        traces = json.dumps(episodes, indent=2)
    user = (
        f"Topic: {topic}\n\nCurrent skill:\n{current_blob}\n\n"
        f"Episodes:\n{traces}\n\nReturn JSON only."
    )
    response = llm.invoke(
        [SystemMessage(content=INDUCTION_SYSTEM), HumanMessage(content=user)]
    )
    payload = _parse_json(_as_text(response.content))
    return SkillProposal.model_validate(payload)


def _as_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and "text" in part:
                parts.append(part["text"])
            else:
                parts.append(str(part))
        return "".join(parts)
    return str(content)


def _parse_json(text: str) -> dict[str, Any]:
    raw = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    else:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]
    return json.loads(raw)


def _draft(state: InductionState) -> dict[str, Any]:
    current = None
    if state.get("current_skill"):
        current = Skill(**state["current_skill"])
    proposal = induce_proposal(state["topic"], state["episodes"], current)
    box = SkillBox(state.get("db_path") or "")
    box.upsert(
        Skill(
            name=proposal.name,
            version=proposal.version,
            status="pending",
            body=proposal.body,
        )
    )
    return {"proposal": proposal.model_dump()}


def _review_gate(state: InductionState) -> dict[str, Any]:
    payload = interrupt(
        {
            "proposal": state["proposal"],
            "current_skill": state.get("current_skill"),
        }
    )
    return {
        "decision": payload["decision"],
        "reason": payload.get("reason", ""),
    }


def _apply(state: InductionState) -> dict[str, Any]:
    box = SkillBox(state.get("db_path") or "")
    proposal = SkillProposal.model_validate(state["proposal"])
    decision = state.get("decision", "reject")
    reason = state.get("reason") or ""
    status = "active" if decision == "approve" else "rejected"
    skill = Skill(
        name=proposal.name,
        version=proposal.version,
        status=status,
        body=proposal.body,
        review_reason=reason,
    )
    box.upsert(skill)
    if status == "active":
        box.supersede_previous(skill.name, skill.version)
    return {"applied": skill.__dict__}


def build_induction_graph():
    graph = StateGraph(InductionState)
    graph.add_node("draft", _draft)
    graph.add_node("review", _review_gate)
    graph.add_node("apply", _apply)
    graph.add_edge(START, "draft")
    graph.add_edge("draft", "review")
    graph.add_edge("review", "apply")
    graph.add_edge("apply", END)
    return graph.compile(checkpointer=MemorySaver())


def start_induction(
    *,
    topic: str,
    episodes: list[Episode],
    current: Skill | None,
    db_path: str,
    thread_id: str = "l2-induction",
):
    app = build_induction_graph()
    config = {"configurable": {"thread_id": thread_id}}
    result = app.invoke(
        {
            "topic": topic,
            "db_path": db_path,
            "episodes": episodes_to_dicts(episodes),
            "current_skill": current.__dict__ if current else None,
        },
        config=config,
    )
    return app, config, result


def resume_induction(app, config, *, decision: str, reason: str):
    return app.invoke(
        Command(resume={"decision": decision, "reason": reason}),
        config=config,
    )
