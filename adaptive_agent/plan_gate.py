"""Cursor-style plan gate: clarifying answers written by the desktop UI."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from adaptive_agent.memory import ROOT

GATE_PATH = ROOT / "data" / "plan_gate.json"


def write_gate(payload: dict[str, Any]) -> None:
    GATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    GATE_PATH.write_text(json.dumps(payload), encoding="utf-8")


def read_gate() -> dict[str, Any]:
    if not GATE_PATH.exists():
        return {}
    try:
        data = json.loads(GATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def wait_for_answers(gate_id: str, *, timeout: float = 300, interval: float = 0.4) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        data = read_gate()
        if data.get("id") == gate_id and data.get("status") == "answered":
            answers = data.get("answers")
            return answers if isinstance(answers, dict) else {}
        time.sleep(interval)
    return {}
