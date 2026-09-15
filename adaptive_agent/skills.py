"""Skill Box: versioned skills with keyword retrieval."""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from adaptive_agent.memory import DEFAULT_DB, ROOT

SKILLS_DIR = ROOT / "skills"


@dataclass
class Skill:
    name: str
    version: int
    status: str
    body: str
    review_reason: str | None = None

    @property
    def heading(self) -> str:
        return f"{self.name} v{self.version} ({self.status})"


class SkillBox:
    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = Path(db_path) if db_path else DEFAULT_DB
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
                CREATE TABLE IF NOT EXISTS skills (
                    name TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    body TEXT NOT NULL,
                    review_reason TEXT,
                    PRIMARY KEY (name, version)
                );
                """
            )

    def seed_from_files(self, skills_dir: Path | None = None) -> None:
        directory = skills_dir or SKILLS_DIR
        if not directory.exists():
            return
        for path in sorted(directory.glob("*.md")):
            text = path.read_text(encoding="utf-8")
            name, version, body = _parse_skill_file(path.stem, text)
            if self.get(name, version) is None:
                self.upsert(Skill(name=name, version=version, status="active", body=body))

    def upsert(self, skill: Skill) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO skills (name, version, status, body, review_reason)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(name, version) DO UPDATE SET
                    status = excluded.status,
                    body = excluded.body,
                    review_reason = excluded.review_reason
                """,
                (skill.name, skill.version, skill.status, skill.body, skill.review_reason),
            )

    def get(self, name: str, version: int) -> Skill | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM skills WHERE name = ? AND version = ?",
                (name, version),
            ).fetchone()
        return _row_to_skill(row) if row else None

    def active_skill(self, name: str) -> Skill | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM skills
                WHERE name = ? AND status = 'active'
                ORDER BY version DESC
                LIMIT 1
                """,
                (name,),
            ).fetchone()
        return _row_to_skill(row) if row else None

    def pending(self) -> list[Skill]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM skills WHERE status = 'pending' ORDER BY name, version"
            ).fetchall()
        return [_row_to_skill(row) for row in rows]

    def all_skills(self) -> list[Skill]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM skills ORDER BY name, version"
            ).fetchall()
        return [_row_to_skill(row) for row in rows]

    def search(self, query: str, k: int = 1) -> list[tuple[Skill, float]]:
        actives = [s for s in self.all_skills() if s.status == "active"]
        scored = [(skill, _overlap_score(query, skill)) for skill in actives]
        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:k]

    def supersede_previous(self, name: str, keep_version: int) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE skills
                SET status = 'superseded'
                WHERE name = ? AND version != ? AND status = 'active'
                """,
                (name, keep_version),
            )


def _row_to_skill(row: sqlite3.Row) -> Skill:
    return Skill(
        name=row["name"],
        version=row["version"],
        status=row["status"],
        body=row["body"],
        review_reason=row["review_reason"],
    )


def _parse_skill_file(stem: str, text: str) -> tuple[str, int, str]:
    name = stem
    version = 1
    match = re.match(r"^(?P<name>.+)-v(?P<ver>\d+)$", stem)
    if match:
        name = match.group("name")
        version = int(match.group("ver"))
    return name, version, text.strip()


def _tokenize(text: str) -> set[str]:
    return {tok for tok in re.findall(r"[a-z0-9]+", text.lower()) if len(tok) > 2}


def _overlap_score(query: str, skill: Skill) -> float:
    q = _tokenize(query)
    d = _tokenize(f"{skill.name} {skill.body}")
    if not q or not d:
        return 0.0
    return len(q & d) / len(q)
