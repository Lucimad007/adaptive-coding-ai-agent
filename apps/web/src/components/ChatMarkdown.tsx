import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export default function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = splitFences(text);
  return (
    <div className={cn("space-y-3 text-[13px] leading-6 text-zinc-200", className)}>
      {blocks.map((block, i) =>
        block.kind === "code" ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-lg border border-[#2b2b2b] bg-[#0f0f10] px-3 py-2.5 font-mono text-[12px] leading-5 text-zinc-300"
          >
            {block.lang ? (
              <div className="mb-1.5 font-sans text-[10px] uppercase tracking-wide text-zinc-500">{block.lang}</div>
            ) : null}
            <code>{block.text}</code>
          </pre>
        ) : (
          <div key={i} className="space-y-2">
            {block.text.split(/\n{2,}/).map((para, j) => (
              <Block key={j} text={para} />
            ))}
          </div>
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

function Block({ text }: { text: string }) {
  const lines = text.replace(/^\n+|\n+$/g, "").split("\n");
  if (!lines[0]) return null;
  const heading = lines[0].match(/^(#{1,3})\s+(.*)$/);
  if (heading && lines.length === 1) {
    const n = heading[1].length;
    const cls =
      n === 1
        ? "text-[16px] font-semibold tracking-tight text-zinc-50"
        : n === 2
          ? "text-[14px] font-semibold text-zinc-100"
          : "text-[13px] font-medium text-zinc-200";
    return <div className={cls}>{inline(heading[2])}</div>;
  }
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-zinc-300">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
        ))}
      </ul>
    );
  }
  return <p className="text-zinc-300">{inline(lines.join(" "))}</p>;
}

function inline(src: string): ReactNode[] {
  const tokens = src.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((tok, i) => {
    if (!tok) return <Fragment key={i} />;
    const bold = tok.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i} className="font-medium text-zinc-50">{bold[1]}</strong>;
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
        <a key={i} href={link[2]} className="text-sky-400 underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    return <Fragment key={i}>{tok}</Fragment>;
  });
}
