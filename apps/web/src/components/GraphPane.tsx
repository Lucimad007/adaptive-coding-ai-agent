import { useEffect, useRef } from "react";

type Node = { id: string; kind?: string; label?: string };
type Edge = { source: string; target: string; kind?: string };

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

  useEffect(() => {
    if (!ref.current || !payload) return;
    let network: { destroy: () => void } | null = null;
    (async () => {
      const vis = await import("vis-network/standalone");
      const walk = new Set(payload.walkIds || []);
      const nodes = (payload.nodes as Node[]).slice(0, 80).map((n) => ({
        id: n.id,
        label: n.label || n.id,
        font: { color: "#d4d4d8", size: 11, face: "IBM Plex Sans" },
        color:
          n.id === payload.anchorId
            ? { background: "#f59e0b", border: "#fbbf24" }
            : walk.has(n.id)
              ? { background: "#3f3f46", border: "#a1a1aa" }
              : { background: "#27272a", border: "#3f3f46" },
        shape: (n.kind === "file" ? "box" : "dot") as const,
      }));
      const idSet = new Set(nodes.map((n) => n.id));
      const edges = ((payload.edges || []) as Edge[])
        .filter((e) => idSet.has(e.source) && idSet.has(e.target))
        .slice(0, 120)
        .map((e, i) => ({
          id: String(i),
          from: e.source,
          to: e.target,
          arrows: "to",
          color: { color: e.kind === "call" ? "#fb7185" : "#52525b" },
        }));
      network = new vis.Network(ref.current!, { nodes, edges }, {
        physics: false,
        interaction: { hover: true },
      });
    })();
    return () => network?.destroy();
  }, [payload]);

  return <div ref={ref} className="h-full min-h-[160px] w-full bg-[#1e1e1e]" />;
}
