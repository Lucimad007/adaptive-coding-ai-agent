"""Base model + loadable adapters; a router snaps one on per task.

The OpenCode Go base (DeepSeek Flash by default) stays frozen. Each adapter is a
small patch: extra system instructions and an optional model id.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass

from adaptive_agent.llm import OPENCODE_MODEL, build_llm


@dataclass(frozen=True)
class Adapter:
    name: str
    description: str
    patch: str
    model: str | None = None
    triggers: tuple[str, ...] = ()
    temperature: float = 0.2


BASE_SYSTEM = (
    "You are the frozen base assistant. Follow the active adapter patch. "
    "Do not invent capabilities the adapter forbids."
)

ADAPTERS: dict[str, Adapter] = {
    "coding": Adapter(
        name="coding",
        description="Default coding / debugging / tests",
        model=None,
        triggers=("code", "bug", "test", "pytest", "function", "refactor", "implement", "graph"),
        patch="Be precise. Prefer tools and concrete steps. Match existing project style.",
    ),
    "refuse_unknowns": Adapter(
        name="refuse_unknowns",
        description="Refuse when the answer is unknown or out of scope",
        model=None,
        triggers=(
            "unknown",
            "not sure",
            "guess",
            "secret",
            "password",
            "credentials",
            "refuse",
            "don't know",
            "do not know",
        ),
        patch=(
            "ACTIVE POLICY: refuse unknowns. If you lack enough context, say you do not know. "
            "Do not guess. Do not reveal secrets or credentials."
        ),
    ),
    "polite_persona": Adapter(
        name="polite_persona",
        description="Warm, concise, customer-facing tone",
        model=None,
        triggers=("please", "thank", "sorry", "customer", "email", "polite", "kindly"),
        patch="Write in a polite, short, professional voice. No slang. Acknowledge the user first.",
        temperature=0.4,
    ),
    "brand_voice": Adapter(
        name="brand_voice",
        description="Marketing / product copy",
        model=None,
        triggers=("brand", "tagline", "landing", "headline", "marketing", "copy", "campaign"),
        patch=(
            "Brand voice: confident, specific, no hype adjectives like 'delve' or 'robust'. "
            "Short sentences. Lead with the user outcome."
        ),
        temperature=0.5,
    ),
}


@dataclass
class Route:
    adapter: Adapter
    model: str
    system_prompt: str
    score: float
    reason: str

    @property
    def name(self) -> str:
        return self.adapter.name


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9']+", text.lower()) if len(t) > 1}


def route_task(task: str, *, default: str = "coding") -> Route:
    """Pick one adapter for this request. Base model weights are never rewritten."""
    q = task.lower()
    q_tokens = _tokens(task)
    ranked: list[tuple[float, Adapter]] = []
    for adapter in ADAPTERS.values():
        hits = sum(1 for trig in adapter.triggers if trig in q or trig in q_tokens)
        ranked.append((float(hits), adapter))
    ranked.sort(key=lambda item: item[0], reverse=True)
    score, adapter = ranked[0]
    if score <= 0:
        adapter = ADAPTERS[default]
        reason = f"no trigger match; default {default}"
        score = 0.0
    else:
        reason = f"trigger score {score:g}"
    model = adapter.model or OPENCODE_MODEL
    system_prompt = f"{BASE_SYSTEM}\n\n## Active adapter: {adapter.name}\n{adapter.patch}"
    return Route(adapter=adapter, model=model, system_prompt=system_prompt, score=score, reason=reason)


def build_routed_llm(task: str):
    chosen = route_task(task)
    return chosen, build_llm(model=chosen.model, temperature=chosen.adapter.temperature)


def format_route(chosen: Route, task: str) -> str:
    others = ", ".join(name for name in ADAPTERS if name != chosen.name)
    return (
        f"task    : {task}\n"
        f"router  : picks per task\n"
        f"active  : {chosen.name}  ({chosen.reason})\n"
        f"model   : {chosen.model}  (frozen base; adapter is a prompt/model patch)\n"
        f"idle    : {others}\n"
        f"patch   : {chosen.adapter.patch[:120]}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Route a task to a frozen-base adapter")
    parser.add_argument("task", nargs="+", help="User task / question")
    parser.add_argument(
        "--run",
        action="store_true",
        help="Call the routed model (needs OPENCODE_API_KEY)",
    )
    args = parser.parse_args()
    task = " ".join(args.task)
    chosen = route_task(task)
    print(format_route(chosen, task))
    if args.run:
        from langchain_core.messages import HumanMessage, SystemMessage

        llm = build_llm(model=chosen.model, temperature=chosen.adapter.temperature)
        msg = llm.invoke(
            [SystemMessage(content=chosen.system_prompt), HumanMessage(content=task)]
        )
        print("\n--- reply ---\n")
        print(msg.content)


if __name__ == "__main__":
    main()
