import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export default function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return (
    <div className={cn("space-y-3 break-words text-[13px] leading-6 text-zinc-200", className)}>
      {splitFences(src).map((block, i) =>
        block.kind === "code" ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-lg border border-[#2b2b2b] bg-[#0f0f10] px-3 py-2.5 font-mono text-[12px] leading-5 text-zinc-300"
          >
            {block.lang ? (
              <div className="mb-1.5 font-sans text-[10px] uppercase tracking-wide text-zinc-500">{block.lang}</div>
            ) : null}
            <code className="whitespace-pre">{block.text}</code>
          </pre>
        ) : (
          <MarkdownLines key={i} text={block.text} />
        ),
      )}
    </div>
  );
}

function splitFences(src: string) {
  const parts: { kind: "md" | "code"; text: string; lang?: string }[] = [];
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) parts.push({ kind: "md", text: src.slice(last, m.index) });
    parts.push({ kind: "code", lang: m[1].trim() || undefined, text: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ kind: "md", text: src.slice(last) });
  return parts;
}

function MarkdownLines({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const n = Math.min(heading[1].length, 3);
      const cls =
        n === 1
          ? "pt-1 text-[16px] font-semibold tracking-tight text-zinc-50"
          : n === 2
            ? "pt-1 text-[14px] font-semibold text-zinc-100"
            : "pt-0.5 text-[13px] font-medium text-zinc-200";
      nodes.push(
        <div key={k++} className={cls}>
          {inline(heading[2])}
        </div>,
      );
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ul key={k++} className="list-disc space-y-1 pl-5 text-zinc-300">
          {items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (!cells.every((c) => /^[-:]+$/.test(c))) rows.push(cells);
        i += 1;
      }
      nodes.push(
        <div key={k++} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px] text-zinc-300">
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-[#2b2b2b]">
                  {row.map((cell, ci) => (
                    <td key={ci} className={cn("py-1 pr-3", ri === 0 && "font-medium text-zinc-100")}>
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\|/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    nodes.push(
      <p key={k++} className="text-zinc-300">
        {inline(para.join(" "))}
      </p>,
    );
  }
  return <div className="space-y-2">{nodes}</div>;
}

function inline(src: string): ReactNode[] {
  const tokens = src.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((tok, i) => {
    if (!tok) return <Fragment key={i} />;
    const bold = tok.match(/^\*\*([^*]+)\*\*$/);
    if (bold)
      return (
        <strong key={i} className="font-medium text-zinc-50">
          {bold[1]}
        </strong>
      );
    const code = tok.match(/^`([^`]+)`$/);
    if (code)
      return (
        <code key={i} className="rounded bg-[#2a2a2a] px-1 py-0.5 font-mono text-[12px] text-amber-200/90">
          {code[1]}
        </code>
      );
    const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a
          key={i}
          href={link[2]}
          className="text-sky-400 underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {link[1]}
        </a>
      );
    return <Fragment key={i}>{tok}</Fragment>;
  });
}
