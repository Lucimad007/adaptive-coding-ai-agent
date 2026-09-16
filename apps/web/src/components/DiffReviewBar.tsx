import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DiffReviewBar({
  path,
  index,
  total,
  onPrev,
  onNext,
  onUndo,
  onKeep,
}: {
  path: string;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onUndo: () => void;
  onKeep: () => void;
}) {
  const file = path.split("/").pop() || path;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border-subtle bg-[var(--editor)] px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={index <= 0}
            onClick={onPrev}
            aria-label="Previous file"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[4.5rem] text-center font-mono text-[11px] text-muted-foreground">
            {index + 1} of {total}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={index >= total - 1}
            onClick={onNext}
            aria-label="Next file"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <span className="hidden max-w-[200px] truncate font-mono text-[11px] text-foreground sm:inline" title={path}>
          {file}
        </span>
        <div className="ml-1 flex items-center gap-1.5 border-l border-border-subtle pl-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onUndo}
          >
            Undo
            <kbd className="ml-1.5 hidden rounded border border-border-subtle px-1 font-sans text-[10px] opacity-70 lg:inline">
              Ctrl+N
            </kbd>
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 bg-[#2ea043] px-3 text-[11px] text-white hover:bg-[#3fb950]"
            onClick={onKeep}
          >
            Accept
            <kbd className="ml-1.5 hidden rounded border border-white/20 px-1 font-sans text-[10px] opacity-90 lg:inline">
              Ctrl+Shift+Y
            </kbd>
          </Button>
        </div>
    </div>
  );
}
