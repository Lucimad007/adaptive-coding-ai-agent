"""Interactive HTML visualization of a code knowledge graph."""

from __future__ import annotations

import argparse
import json
import webbrowser
from pathlib import Path

from adaptive_agent.code_graph import CodeGraph, build_code_graph
from adaptive_agent.graph_retrieve import graph_retrieve, starter_code_graph
from adaptive_agent.memory import ROOT

KIND_EDGE_COLOR = {
    "import": "#4a90d9",
    "contains": "#9aa3ad",
    "call": "#e07a5f",
    "co_edit": "#2a9d8f",
}


def write_graph_html(
    graph: CodeGraph,
    path: Path,
    *,
    title: str = "Code knowledge graph",
    query: str | None = None,
    walk_ids: list[str] | None = None,
    anchor_id: str | None = None,
) -> Path:
    walk = set(walk_ids or [])
    nodes = []
    for node in graph.nodes.values():
        is_file = node.kind == "file"
        is_anchor = node.id == anchor_id
        is_walk = node.id in walk
        nodes.append(
            {
                "id": node.id,
                "label": node.label,
                "title": f"{node.kind}: {node.id}",
                "shape": "box" if is_file else "triangle",
                "color": {
                    "background": "#f4a261" if is_anchor else ("#3d5a80" if is_walk else ("#eceff3" if is_file else "#8ecae6")),
                    "border": "#e76f51" if is_anchor else ("#1d3557" if is_walk else "#6b7280"),
                },
                "borderWidth": 4 if is_anchor else (3 if is_walk else 1),
                "font": {"size": 14 if is_anchor or is_walk else 12},
            }
        )

    edges = []
    seen_coedit: set[tuple[str, str]] = set()
    for edge in graph.edges.values():
        if edge.kind == "co_edit":
            pair = tuple(sorted((edge.source, edge.target)))
            if pair in seen_coedit:
                continue
            seen_coedit.add(pair)
        dashes = edge.kind in {"call", "co_edit"}
        edges.append(
            {
                "from": edge.source,
                "to": edge.target,
                "arrows": "to" if edge.kind != "co_edit" else None,
                "dashes": dashes,
                "color": {"color": KIND_EDGE_COLOR.get(edge.kind, "#999")},
                "title": edge.kind,
                "kind": edge.kind,
                "smooth": {"type": "continuous"},
            }
        )

    caption = title
    if query:
        caption += f" — query: {query}"

    html = _TEMPLATE.replace("__TITLE__", _esc(caption)).replace(
        "__PAYLOAD__",
        json.dumps({"nodes": nodes, "edges": edges}, indent=2),
    )
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return path


def write_anchor_walk_html(graph: CodeGraph, query: str, path: Path, *, k: int = 4) -> Path:
    result = graph_retrieve(graph, query, k=k, n_anchors=1)
    walk_ids = [node.id for node, _ in result["hits"]]
    anchor = result["anchors"][0].id if result["anchors"] else None
    return write_graph_html(
        graph,
        path,
        title="Anchor walk",
        query=query,
        walk_ids=walk_ids,
        anchor_id=anchor,
    )


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>__TITLE__</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    html, body { margin: 0; height: 100%; font-family: Segoe UI, sans-serif; background: #f7f7f5; }
    #bar { padding: 12px 16px; border-bottom: 1px solid #ddd; background: #fff; }
    h1 { font-size: 16px; margin: 0 0 8px; font-weight: 600; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: #444; }
    .swatch { display: inline-block; width: 14px; height: 10px; margin-right: 4px; vertical-align: middle; border: 1px solid #555; }
    #filters { margin-top: 8px; font-size: 12px; }
    #network { height: calc(100% - 92px); }
  </style>
</head>
<body>
  <div id="bar">
    <h1>__TITLE__</h1>
    <div class="legend">
      <span><span class="swatch" style="background:#eceff3"></span>file</span>
      <span><span class="swatch" style="background:#8ecae6; clip-path: polygon(50% 0, 100% 100%, 0 100%)"></span>function / symbol</span>
      <span><span class="swatch" style="background:#4a90d9"></span>import</span>
      <span><span class="swatch" style="background:#9aa3ad"></span>contains</span>
      <span><span class="swatch" style="background:#e07a5f"></span>call (dashed)</span>
      <span><span class="swatch" style="background:#2a9d8f"></span>co_edit (dashed)</span>
      <span><span class="swatch" style="background:#3d5a80"></span>reached by walk</span>
      <span><span class="swatch" style="background:#f4a261"></span>anchor</span>
    </div>
    <div id="filters">
      Show:
      <label><input type="checkbox" data-kind="import" checked> import</label>
      <label><input type="checkbox" data-kind="contains" checked> contains</label>
      <label><input type="checkbox" data-kind="call" checked> call</label>
      <label><input type="checkbox" data-kind="co_edit" checked> co_edit</label>
    </div>
  </div>
  <div id="network"></div>
  <script>
    const payload = __PAYLOAD__;
    const nodes = new vis.DataSet(payload.nodes);
    const edges = new vis.DataSet(payload.edges.map((e, i) => ({ id: i, ...e })));
    const network = new vis.Network(
      document.getElementById("network"),
      { nodes, edges },
      {
        interaction: { hover: true, tooltipDelay: 80 },
        physics: { stabilization: { iterations: 200 }, barnesHut: { gravitationalConstant: -2800 } },
        edges: { width: 1.4 },
      }
    );
    document.querySelectorAll("#filters input").forEach((box) => {
      box.addEventListener("change", () => {
        const on = new Set(
          [...document.querySelectorAll("#filters input:checked")].map((el) => el.dataset.kind)
        );
        edges.forEach((edge) => {
          edges.update({ id: edge.id, hidden: !on.has(edge.kind) });
        });
      });
    });
  </script>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Open a visual code knowledge graph in the browser")
    parser.add_argument("--repo", default="", help="Target Python repo. Omit to show the L4 starter graph.")
    parser.add_argument("--query", default="", help="Optional retrieval query to highlight an anchor walk")
    parser.add_argument("--out", default="", help="HTML output path")
    parser.add_argument("--no-open", action="store_true", help="Write the file without opening a browser")
    args = parser.parse_args()

    if args.repo:
        root = Path(args.repo).expanduser().resolve()
        graph = build_code_graph(root)
        name = root.name
    else:
        graph = starter_code_graph()
        name = "starter"

    out = Path(args.out) if args.out else ROOT / "data" / "graphs" / f"{name}.html"
    if args.query:
        path = write_anchor_walk_html(graph, args.query, out)
    else:
        path = write_graph_html(graph, out, title=f"Code knowledge graph: {name}")
    print(path)
    if not args.no_open:
        webbrowser.open(path.resolve().as_uri())


if __name__ == "__main__":
    main()
