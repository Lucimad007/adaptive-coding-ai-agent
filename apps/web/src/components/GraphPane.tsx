import { useEffect, useMemo, useRef, useState } from "react";

type Node = { id: string; kind?: string; label?: string };
type Edge = { source: string; target: string; kind?: string; weight?: number };

type Network = {
  destroy: () => void;
  setSize: (w: string, h: string) => void;
  redraw: () => void;
  fit: (opts?: { animation?: boolean }) => void;
  on: (ev: string, cb: () => void) => void;
};

const EDGE_STYLES = {
  import: {
    color: "#5b9bd5",
    dashes: false as boolean | number[],
    arrows: "to" as const,
    label: "import",
  },
  call: {
    color: "#e07a5f",
    dashes: [8, 6] as boolean | number[],
    arrows: "to" as const,
    label: "call",
  },
  co_edit: {
    color: "#2a9d8f",
    dashes: [2, 6] as boolean | number[],
    arrows: undefined,
    label: "co-edit",
  },
};

type EdgeKind = keyof typeof EDGE_STYLES;

export default function GraphPane({
  payload,
}: {
  payload: {
    nodes: unknown[];
    edges?: unknown[];
    walkIds: string[];
    anchorId?: string;
  } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Record<EdgeKind, boolean>>({
    import: true,
    call: true,
    co_edit: true,
  });

  const counts = useMemo(() => countKinds(payload), [payload]);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let cancelled = false;
    let network: Network | null = null;

    const size = () => {
      if (!network || !host.clientWidth || !host.clientHeight) return;
      network.setSize(`${host.clientWidth}px`, `${host.clientHeight}px`);
      network.redraw();
      network.fit({ animation: false });
    };

    (async () => {
      if (!payload?.nodes?.length) return;
      const vis = await import("vis-network/standalone");
      if (cancelled || !ref.current) return;

      const walk = new Set(payload.walkIds || []);
      const rawNodes = payload.nodes as Node[];
      const rawEdges = ((payload.edges || []) as Edge[]).filter((e) => isEdgeKind(e.kind));
      const keptKinds = new Set(
        (Object.keys(shown) as EdgeKind[]).filter((k) => shown[k]),
      );

      const seenCoedit = new Set<string>();
      const typedEdges = rawEdges.filter((e) => {
        const kind = e.kind as EdgeKind;
        if (!keptKinds.has(kind)) return false;
        if (kind === "co_edit") {
          const pair = [e.source, e.target].sort().join("\0");
          if (seenCoedit.has(pair)) return false;
          seenCoedit.add(pair);
        }
        return true;
      });

      const connected = new Set<string>();
      for (const e of typedEdges) {
        connected.add(e.source);
        connected.add(e.target);
      }
      for (const id of walk) connected.add(id);
      if (payload.anchorId) connected.add(payload.anchorId);

      const nodes = rawNodes
        .filter((n) => connected.has(n.id) || (!typedEdges.length && n.kind === "file"))
        .slice(0, 140)
        .map((n) => {
          const isFile = n.kind === "file";
          const isAnchor = n.id === payload.anchorId;
          const onWalk = walk.has(n.id);
          const label = shortLabel(n);
          return {
            id: n.id,
            label,
            title: `${isFile ? "File" : "Symbol"}\n${n.id}`,
            shape: isFile ? "box" : "dot",
            size: isFile ? 16 : 10,
            borderWidth: isAnchor ? 3 : onWalk ? 2 : 1,
            font: { color: "#f5f5f5", size: isAnchor || onWalk ? 13 : 11, face: "IBM Plex Sans" },
            color: isAnchor
              ? { background: "#f0c14b", border: "#f5d98a" }
              : onWalk
                ? { background: isFile ? "#3a3a3a" : "#4a4a4a", border: "#f0c14b" }
                : isFile
                  ? { background: "#2a2a2a", border: "#6a6a6a" }
                  : { background: "#3d5a80", border: "#8ecae6" },
          };
        });
      const idSet = new Set(nodes.map((n) => n.id));

      const edges = typedEdges
        .filter((e) => idSet.has(e.source) && idSet.has(e.target))
        .slice(0, 220)
        .map((e, i) => {
          const kind = e.kind as EdgeKind;
          const style = EDGE_STYLES[kind];
          const w = Math.min(4, 1 + Math.log2(1 + (e.weight || 1)));
          return {
            id: String(i),
            from: e.source,
            to: e.target,
            arrows: style.arrows,
            dashes: style.dashes,
            width: w,
            color: { color: style.color, highlight: style.color },
            title: `${style.label}${e.weight && e.weight > 1 ? ` ×${e.weight}` : ""}`,
            font: { color: "#c8c8c8", size: 9, strokeWidth: 0, align: "middle" as const },
            label: nodes.length < 40 ? style.label : undefined,
          };
        });

      network = new vis.Network(
        ref.current,
        { nodes, edges },
        {
          autoResize: true,
          physics: {
            enabled: true,
            stabilization: { iterations: 120 },
            barnesHut: {
              gravitationalConstant: -4200,
              springLength: 130,
              springConstant: 0.04,
              damping: 0.4,
            },
          },
          layout: { improvedLayout: true },
          interaction: { hover: true, zoomView: true, tooltipDelay: 80 },
          nodes: { margin: 8 },
          edges: { smooth: { type: "cubicBezier", forceDirection: "none", roundness: 0.35 } },
        },
      ) as unknown as Network;
      network.on("stabilizationIterationsDone", () => {
        network?.fit({ animation: false });
      });
      requestAnimationFrame(size);
      window.setTimeout(size, 50);
      window.setTimeout(size, 250);
    })();

    const ro = new ResizeObserver(() => size());
    ro.observe(host);

    return () => {
      cancelled = true;
      ro.disconnect();
      network?.destroy();
    };
  }, [payload, shown]);

  if (!payload?.nodes?.length) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
        No graph yet. Use Graph in the title bar or wait for indexing to finish.
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[280px] w-full min-w-0 flex-1 overflow-hidden bg-[var(--editor)]">
      <div ref={ref} className="h-full w-full min-h-0 min-w-0" />
      <aside className="absolute bottom-3 left-3 z-10 w-[min(100%-1.5rem,248px)] rounded-md border border-border-subtle bg-[color-mix(in_srgb,var(--background)_90%,transparent)] px-3 py-2.5 shadow-[var(--elev-raised)] backdrop-blur-sm">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Legend</p>
        <ul className="space-y-2 text-[11px] text-foreground">
          <li className="flex items-center gap-2">
            <span className="h-3 w-5 shrink-0 rounded-[2px] bg-[#2a2a2a] ring-1 ring-[#6a6a6a]" />
            File
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full bg-[#3d5a80] ring-1 ring-[#8ecae6]" />
            Function / symbol
          </li>
          {(Object.keys(EDGE_STYLES) as EdgeKind[]).map((kind) => (
            <li key={kind}>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-3 accent-[#f0c14b]"
                  checked={shown[kind]}
                  onChange={() => setShown((s) => ({ ...s, [kind]: !s[kind] }))}
                />
                <EdgeSwatch kind={kind} />
                <span className="capitalize">
                  {kind === "call" ? "Function call" : kind === "co_edit" ? "Co-edit" : "Import"}
                  <span className="ml-1 text-muted-foreground">({counts[kind]})</span>
                </span>
              </label>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm bg-[#f0c14b] ring-1 ring-[#f5d98a]" />
            Query match
          </li>
        </ul>
      </aside>
    </div>
  );
}

function EdgeSwatch({ kind }: { kind: EdgeKind }) {
  const { color, dashes } = EDGE_STYLES[kind];
  const dashed = Array.isArray(dashes);
  return (
    <span
      className="inline-block h-px w-7 shrink-0"
      style={{
        background: dashed
          ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`
          : color,
        height: kind === "co_edit" ? 2 : 1.5,
      }}
    />
  );
}

function isEdgeKind(kind?: string): kind is EdgeKind {
  return kind === "import" || kind === "call" || kind === "co_edit";
}

function shortLabel(n: Node) {
  const raw = n.label || n.id;
  const base = raw.split(/[\\/]/).pop() || raw;
  return base.length > 28 ? `${base.slice(0, 26)}…` : base;
}

function countKinds(payload: { edges?: unknown[] } | null) {
  const counts: Record<EdgeKind, number> = { import: 0, call: 0, co_edit: 0 };
  const seen = new Set<string>();
  for (const e of (payload?.edges || []) as Edge[]) {
    if (!isEdgeKind(e.kind)) continue;
    if (e.kind === "co_edit") {
      const pair = [e.source, e.target].sort().join("\0");
      if (seen.has(pair)) continue;
      seen.add(pair);
    }
    counts[e.kind] += 1;
  }
  return counts;
}
