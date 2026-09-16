import { ChevronRight, FileCode, Folder } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type FileEntry = {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: FileEntry[];
};

export default function FileTree({
  entries,
  onOpen,
  activePath,
  depth = 0,
}: {
  entries: FileEntry[];
  onOpen: (path: string) => void;
  activePath?: string;
  depth?: number;
}) {
  return (
    <div className="flex flex-col">
      {entries.map((e) =>
        e.kind === "dir" ? (
          <DirNode key={e.path} entry={e} onOpen={onOpen} activePath={activePath} depth={depth} />
        ) : (
          <Button
            key={e.path}
            data-testid={`file-${e.path}`}
            variant="ghost"
            size="sm"
            onClick={() => onOpen(e.path)}
            className={cn(
              "h-7 w-full justify-start gap-1.5 rounded-none px-2 font-normal text-muted-foreground hover:text-foreground",
              activePath === e.path && "bg-accent text-foreground",
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <FileCode className="size-3.5 opacity-70" />
            <span className="truncate">{e.name}</span>
          </Button>
        ),
      )}
    </div>
  );
}

function DirNode({
  entry,
  onOpen,
  activePath,
  depth,
}: {
  entry: FileEntry;
  onOpen: (path: string) => void;
  activePath?: string;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-full justify-start gap-1 rounded-none px-2 font-normal text-muted-foreground hover:text-foreground"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        <Folder className="size-3.5 opacity-70" />
        <span className="truncate">{entry.name}</span>
      </Button>
      {open ? (
        <FileTree entries={entry.children || []} onOpen={onOpen} activePath={activePath} depth={depth + 1} />
      ) : null}
    </div>
  );
}
