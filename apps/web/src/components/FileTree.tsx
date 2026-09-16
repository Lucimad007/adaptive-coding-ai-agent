import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/lib/files";
import type { FileEntry } from "@/lib/fileEntry";
import { gitNameClass, gitStatusAccentClass, gitStatusDotClass, gitStatusLetter, gitStatusTitle, type GitStatus } from "@/lib/gitStatus";

export type { FileEntry } from "@/lib/fileEntry";

export default function FileTree({
  entries,
  onOpen,
  activePath,
  gitLabels = {},
  depth = 0,
}: {
  entries: FileEntry[];
  onOpen: (path: string) => void;
  activePath?: string;
  gitLabels?: Record<string, GitStatus>;
  depth?: number;
}) {
  return (
    <div className="flex flex-col py-1">
      {entries.map((e) =>
        e.kind === "dir" ? (
          <DirNode
            key={e.path}
            entry={e}
            onOpen={onOpen}
            activePath={activePath}
            gitLabels={gitLabels}
            depth={depth}
          />
        ) : (
          <FileNode key={e.path} entry={e} onOpen={onOpen} activePath={activePath} gitLabels={gitLabels} depth={depth} />
        ),
      )}
    </div>
  );
}

function FileNode({
  entry,
  onOpen,
  activePath,
  gitLabels,
  depth,
}: {
  entry: FileEntry;
  onOpen: (path: string) => void;
  activePath?: string;
  gitLabels: Record<string, GitStatus>;
  depth: number;
}) {
  const active = activePath === entry.path;
  const status = gitLabels[entry.path] || "clean";
  const letter = gitStatusLetter(status);
  return (
    <Button
      data-testid={`file-${entry.path}`}
      variant="ghost"
      size="sm"
      onClick={() => onOpen(entry.path)}
      title={gitStatusTitle(status)}
      className={cn(
        "h-6 w-full justify-between gap-1 rounded-none pl-2 pr-3 text-[12.5px] font-normal hover:bg-accent",
        active && "bg-accent shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <FileTypeIcon name={entry.name} />
        <span className={cn("truncate", gitNameClass(status, active))}>{entry.name}</span>
      </span>
      {letter ? (
        <span
          className={cn(
            "mr-0.5 shrink-0 font-mono text-[11px] font-semibold tabular-nums opacity-70",
            gitStatusAccentClass(status),
          )}
        >
          {letter}
        </span>
      ) : null}
    </Button>
  );
}

function DirNode({
  entry,
  onOpen,
  activePath,
  gitLabels,
  depth,
}: {
  entry: FileEntry;
  onOpen: (path: string) => void;
  activePath?: string;
  gitLabels: Record<string, GitStatus>;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const status = gitLabels[entry.path] || "clean";
  const showDot = status !== "clean";
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        title={gitStatusTitle(status)}
        className="h-6 w-full justify-between gap-1 rounded-none pl-2 pr-3 text-[12.5px] font-normal hover:bg-accent"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground/80 transition-transform", open && "rotate-90")} />
          <span className={cn("truncate", gitNameClass(status, false))}>{entry.name}</span>
        </span>
        {showDot ? (
          <span className={cn("mr-0.5 size-2 shrink-0 rounded-full opacity-70", gitStatusDotClass(status))} aria-hidden />
        ) : null}
      </Button>
      {open ? (
        <FileTree
          entries={entry.children || []}
          onOpen={onOpen}
          activePath={activePath}
          gitLabels={gitLabels}
          depth={depth + 1}
        />
      ) : null}
    </div>
  );
}
