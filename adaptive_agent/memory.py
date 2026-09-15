"""SQLite store for agent traces (episodes)."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "agent.db"


@dataclass
class Episode:
    id: int
    topic: str
    task: str
    outcome: str
    error: str | None
    fix: str | None
    tool_calls: list[dict]
    created_at: str


class Memory:
    def __init__(self, db_path: Path | str = DEFAULT_DB) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS episodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic TEXT NOT NULL,
                    task TEXT NOT NULL,
                    outcome TEXT NOT NULL,
                    error TEXT,
                    fix TEXT,
                    tool_calls TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL
                );
                """
            )

    def add_episode(
        self,
        *,
        topic: str,
        task: str,
        outcome: str,
        error: str | None = None,
        fix: str | None = None,
        tool_calls: list[dict] | None = None,
    ) -> int:
        created_at = datetime.now(timezone.utc).isoformat()
        payload = json.dumps(tool_calls or [])
        with self.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO episodes (topic, task, outcome, error, fix, tool_calls, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (topic, task, outcome, error, fix, payload, created_at),
            )
            return int(cur.lastrowid)

    def episodes_for_topic(self, topic: str) -> list[Episode]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM episodes WHERE topic = ? ORDER BY id",
                (topic,),
            ).fetchall()
        return [self._row_to_episode(row) for row in rows]

    def all_episodes(self) -> list[Episode]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM episodes ORDER BY id").fetchall()
        return [self._row_to_episode(row) for row in rows]

    @staticmethod
    def _row_to_episode(row: sqlite3.Row) -> Episode:
        return Episode(
            id=row["id"],
            topic=row["topic"],
            task=row["task"],
            outcome=row["outcome"],
            error=row["error"],
            fix=row["fix"],
            tool_calls=json.loads(row["tool_calls"]),
            created_at=row["created_at"],
        )
