import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export default function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return (
    <div className={cn("min-w-0 max-w-full space-y-3 overflow-hidden break-words text-[13px] leading-6 text-foreground", className)}>
      {splitFences(src).map((block, i) =>
        block.kind === "code" ? (
          <pre
            key={i}
            className="surface-code max-w-full overflow-x-auto rounded-lg border px-3 py-2.5 font-mono text-[12px] leading-5 text-foreground"
          >
            {block.lang ? (
              <div className="mb-1.5 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{block.lang}</div>
            ) : null}
            <code className="block max-w-full whitespace-pre-wrap break-all">{block.text}</code>
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
          ? "pt-1 text-[16px] font-semibold tracking-tight text-foreground"
          : n === 2
            ? "pt-1 text-[14px] font-semibold text-foreground"
            : "pt-0.5 text-[13px] font-medium text-foreground";
      nodes.push(
        <div key={k++} className={cn(cls, "max-w-full break-words")}>
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
        <ul key={k++} className="list-disc space-y-1 pl-5 text-foreground [overflow-wrap:anywhere]">
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
        <div key={k++} className="max-w-full overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left text-[12px] text-foreground">
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b">
                  {row.map((cell, ci) => (
                    <td key={ci} className={cn("py-1 pr-3 align-top break-all", ri === 0 && "font-medium text-foreground")}>
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
      <p key={k++} className="max-w-full text-foreground/90 [overflow-wrap:anywhere]">
        {inline(para.join(" "))}
      </p>,
    );
  }
  return <div className="min-w-0 max-w-full space-y-2">{nodes}</div>;
}

function inline(src: string): ReactNode[] {
  const tokens = src.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((tok, i) => {
    if (!tok) return <Fragment key={i} />;
    const bold = tok.match(/^\*\*([^*]+)\*\*$/);
    if (bold)
      return (
        <strong key={i} className="font-medium text-foreground">
          {bold[1]}
        </strong>
      );
    const code = tok.match(/^`([^`]+)`$/);
    if (code)
      return (
        <code key={i} className="inline break-all rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-warning shadow-[var(--elev-inset)]">
          {code[1]}
        </code>
      );
    const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a
          key={i}
          href={link[2]}
          className="text-primary underline-offset-2 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {link[1]}
        </a>
      );
    return <Fragment key={i}>{tok}</Fragment>;
  });
}
