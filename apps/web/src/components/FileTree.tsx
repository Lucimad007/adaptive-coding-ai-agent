import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/lib/files";

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
    <div className="flex flex-col py-1">
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
              "h-6 w-full justify-start gap-1.5 rounded-none px-2 text-[12.5px] font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              activePath === e.path && "bg-accent text-accent-foreground shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]",
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <FileTypeIcon name={e.name} />
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
        className="h-6 w-full justify-start gap-1 rounded-none px-2 text-[12.5px] font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground/80 transition-transform", open && "rotate-90")} />
        <span className="truncate">{entry.name}</span>
      </Button>
      {open ? (
        <FileTree entries={entry.children || []} onOpen={onOpen} activePath={activePath} depth={depth + 1} />
      ) : null}
    </div>
  );
}
