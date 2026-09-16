"""Build a code knowledge graph from imports, git co-edits, and function calls."""

from __future__ import annotations

import ast
import json
import subprocess
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path

SKIP_DIRS = {".git", ".venv", "venv", "__pycache__", "node_modules", "dist", "build"}


@dataclass
class Node:
    id: str
    kind: str
    label: str
    path: str


@dataclass
class Edge:
    source: str
    target: str
    kind: str
    weight: float = 1.0


@dataclass
class CodeGraph:
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: dict[tuple[str, str, str], Edge] = field(default_factory=dict)

    def add_node(self, node: Node) -> None:
        self.nodes[node.id] = node

    def add_edge(self, source: str, target: str, kind: str, weight: float = 1.0) -> None:
        if source == target or source not in self.nodes or target not in self.nodes:
            return
        key = (source, target, kind)
        if key in self.edges:
            self.edges[key].weight += weight
        else:
            self.edges[key] = Edge(source, target, kind, weight)

    def to_dict(self) -> dict:
        return {
            "nodes": [asdict(n) for n in sorted(self.nodes.values(), key=lambda n: n.id)],
            "edges": [
                asdict(e)
                for e in sorted(self.edges.values(), key=lambda e: (e.kind, e.source, e.target))
            ],
        }

    def summary(self) -> str:
        by_kind: dict[str, int] = defaultdict(int)
        for edge in self.edges.values():
            by_kind[edge.kind] += 1
        node_kinds: dict[str, int] = defaultdict(int)
        for node in self.nodes.values():
            node_kinds[node.kind] += 1
        lines = [
            f"nodes: {len(self.nodes)} "
            + ", ".join(f"{k}={v}" for k, v in sorted(node_kinds.items())),
            f"edges: {len(self.edges)} "
            + ", ".join(f"{k}={v}" for k, v in sorted(by_kind.items())),
        ]
        return "\n".join(lines)

    def remembered_summary(self, name: str) -> str:
        n_files = sum(1 for n in self.nodes.values() if n.kind == "file")
        n_symbols = sum(1 for n in self.nodes.values() if n.kind != "file")
        counts: dict[str, int] = defaultdict(int)
        seen_coedit: set[tuple[str, str]] = set()
        for edge in self.edges.values():
            if edge.kind == "co_edit":
                pair = tuple(sorted((edge.source, edge.target)))
                if pair in seen_coedit:
                    continue
                seen_coedit.add(pair)
                counts["co_edit"] += 1
            elif edge.kind in {"import", "call"}:
                counts[edge.kind] += 1
        edges = {k: counts.get(k, 0) for k in ("import", "call", "co_edit")}
        return (
            f"=== The codebase the agent remembers: {name} ===\n"
            f"{n_files} files, {n_symbols} symbols (functions/classes/methods); "
            f"edges: {edges}"
        )


def iter_python_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*.py"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        files.append(path)
    return sorted(files)


def file_id(rel: str) -> str:
    return f"file:{rel.replace('\\', '/')}"


def function_id(rel: str, qualname: str) -> str:
    return f"fn:{rel.replace('\\', '/')}:{qualname}"


def module_name(rel: str) -> str:
    posix = rel.replace("\\", "/")
    if posix.endswith("/__init__.py"):
        return posix[: -len("/__init__.py")].replace("/", ".")
    if posix.endswith(".py"):
        posix = posix[: -len(".py")]
    return posix.replace("/", ".")


def package_of(rel: str) -> list[str]:
    parts = module_name(rel).split(".")
    if rel.endswith("__init__.py"):
        return [p for p in parts if p]
    return parts[:-1]


COMMON_CALLEES = {
    "get",
    "set",
    "items",
    "keys",
    "values",
    "append",
    "extend",
    "pop",
    "update",
    "add",
    "write",
    "read",
    "format",
    "join",
    "split",
    "strip",
    "replace",
    "sort",
    "copy",
    "encode",
    "decode",
    "insert",
    "remove",
}


def build_code_graph(root: Path, *, since_commit: str | None = None) -> CodeGraph:
    root = Path(root).resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Repo path does not exist: {root}")
    files = iter_python_files(root)
    rels = {path: path.relative_to(root).as_posix() for path in files}
    modules = {module_name(rel): rel for rel in rels.values()}

    graph = CodeGraph()
    defs_by_file: dict[str, dict[str, str]] = {}
    defs_by_name: dict[str, list[str]] = defaultdict(list)

    for path, rel in rels.items():
        graph.add_node(Node(id=file_id(rel), kind="file", label=rel, path=rel))
        tree = _parse(path)
        if tree is None:
            continue
        local_defs = _function_defs(tree)
        defs_by_file[rel] = {}
        for qualname in local_defs:
            nid = function_id(rel, qualname)
            graph.add_node(Node(id=nid, kind="symbol", label=qualname, path=rel))
            graph.add_edge(file_id(rel), nid, "contains", 1.0)
            short = qualname.split(".")[-1]
            defs_by_file[rel][short] = nid
            defs_by_name[short].append(nid)

    for path, rel in rels.items():
        tree = _parse(path)
        if tree is None:
            continue
        for imported in _imported_modules(tree, rel):
            target_rel = _resolve_module(imported, modules)
            if target_rel:
                graph.add_edge(file_id(rel), file_id(target_rel), "import", 1.0)

        imported_files = {
            e.target
            for e in graph.edges.values()
            if e.source == file_id(rel) and e.kind == "import"
        }
        for caller, called in _function_calls(tree):
            if not caller:
                continue
            source = function_id(rel, caller)
            if source not in graph.nodes:
                continue
            local_target = defs_by_file.get(rel, {}).get(called)
            if local_target:
                graph.add_edge(source, local_target, "call", 1.0)
                continue
            if called in COMMON_CALLEES:
                continue
            targets = defs_by_name.get(called, [])
            if len(targets) == 1:
                graph.add_edge(source, targets[0], "call", 1.0)
            elif len(targets) > 1:
                for tid in targets:
                    owner = file_id(graph.nodes[tid].path)
                    if owner in imported_files:
                        graph.add_edge(source, tid, "call", 1.0)

    for a, b, weight in _coedit_pairs(root, since_commit=since_commit):
        if file_id(a) in graph.nodes and file_id(b) in graph.nodes:
            graph.add_edge(file_id(a), file_id(b), "co_edit", float(weight))
            graph.add_edge(file_id(b), file_id(a), "co_edit", float(weight))

    return graph


def _parse(path: Path) -> ast.AST | None:
    try:
        return ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return None


def _function_defs(tree: ast.AST) -> list[str]:
    names: list[str] = []

    class Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.stack: list[str] = []

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            self.stack.append(node.name)
            names.append(".".join(self.stack))
            self.generic_visit(node)
            self.stack.pop()

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            names.append(".".join([*self.stack, node.name]))
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            names.append(".".join([*self.stack, node.name]))
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

    Visitor().visit(tree)
    return names


def _imported_modules(tree: ast.AST, rel: str) -> list[str]:
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.append(_absolute_from_import(rel, node.level, node.module or ""))
    return [m for m in found if m]


def _absolute_from_import(rel: str, level: int, module: str) -> str:
    if level == 0:
        return module
    parts = package_of(rel)
    up = level - 1
    if up:
        parts = parts[: max(0, len(parts) - up)]
    base = ".".join(parts)
    if module:
        return f"{base}.{module}" if base else module
    return base


def _resolve_module(imported: str, modules: dict[str, str]) -> str | None:
    if imported in modules:
        return modules[imported]
    dotted_init = imported.replace(".", "/") + "/__init__.py"
    for rel in modules.values():
        if rel == dotted_init:
            return rel
    return None


def _function_calls(tree: ast.AST) -> list[tuple[str, str]]:
    """Return (caller_qualname_or_empty, callee_short_name) pairs."""
    pairs: list[tuple[str, str]] = []

    class Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.stack: list[str] = []

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()

        def visit_Call(self, node: ast.Call) -> None:
            name = None
            if isinstance(node.func, ast.Name):
                name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                name = node.func.attr
            if name:
                caller = ".".join(self.stack)
                pairs.append((caller, name))
            self.generic_visit(node)

    Visitor().visit(tree)
    return pairs


def git_head(root: Path) -> str | None:
    try:
        top = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=root,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        if Path(top).resolve() != Path(root).resolve():
            return None
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _coedit_pairs(root: Path, since_commit: str | None = None) -> list[tuple[str, str, int]]:
    if git_head(root) is None:
        return []
    cmd = ["git", "log", "--name-only", "--pretty=format:COMMIT %H"]
    if since_commit:
        cmd.append(f"{since_commit}..HEAD")
    try:
        raw = subprocess.check_output(
            cmd,
            cwd=root,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return []

    counts: dict[tuple[str, str], int] = defaultdict(int)
    bucket: list[str] = []
    for line in raw.splitlines():
        if line.startswith("COMMIT "):
            _tally_bucket(bucket, counts)
            bucket = []
            continue
        path = line.strip().replace("\\", "/")
        if path.endswith(".py"):
            bucket.append(path)
    _tally_bucket(bucket, counts)
    return [(a, b, w) for (a, b), w in counts.items()]


def _tally_bucket(files: list[str], counts: dict[tuple[str, str], int]) -> None:
    unique = sorted(set(files))
    for i, a in enumerate(unique):
        for b in unique[i + 1 :]:
            counts[(a, b)] += 1


def save_graph(graph: CodeGraph, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(graph.to_dict(), indent=2), encoding="utf-8")
    return path


def format_preview(graph: CodeGraph, limit: int = 20) -> str:
    by_kind: dict[str, list[Edge]] = defaultdict(list)
    for edge in graph.edges.values():
        by_kind[edge.kind].append(edge)
    lines = [graph.summary()]
    for kind in ("import", "call", "co_edit", "contains"):
        edges = by_kind.get(kind, [])
        if not edges:
            continue
        lines.append(f"\n{kind} ({len(edges)})")
        for edge in edges[:limit]:
            lines.append(f"  {edge.source} -> {edge.target}  w={edge.weight:g}")
        if len(edges) > limit:
            lines.append(f"  ... {len(edges) - limit} more")
    return "\n".join(lines)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract import, call, and co-edit edges from a Python git repo."
    )
    parser.add_argument("--repo", required=True, help="Path to the target codebase (not this agent repo unless you pass it)")
    parser.add_argument("--out", default="", help="Optional JSON output path")
    args = parser.parse_args()
    root = Path(args.repo).resolve()
    graph = build_code_graph(root)
    print(graph.remembered_summary(root.name))
    print(format_preview(graph))
    if args.out:
        out = save_graph(graph, Path(args.out))
        print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
