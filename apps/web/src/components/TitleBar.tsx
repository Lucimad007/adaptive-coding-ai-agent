import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

function chrome() {
  return window.harness;
}

export default function TitleBar() {
  const api = chrome();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const h = window.harness;
    if (!h?.isWindowMaximized) return;
    h.isWindowMaximized().then(setMaximized).catch(() => undefined);
    return h.onWindowMaximized?.(setMaximized);
  }, []);

  if (!api?.platform) return null;

  const isMac = api.platform === "darwin";

  const onDoubleClick = useCallback(() => {
    api.maximizeWindow?.();
  }, [api]);

  const controls = (
    <div className={cn("titlebar-no-drag flex h-full shrink-0 items-stretch", isMac ? "order-first" : "order-last")}>
      <WinBtn label="Minimize" onClick={() => api.minimizeWindow?.()} className="hover:bg-accent">
        <Minus className="size-3.5" strokeWidth={1.5} />
      </WinBtn>
      <WinBtn
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => api.maximizeWindow?.()}
        className="hover:bg-accent"
      >
        {maximized ? (
          <span className="relative block size-3">
            <Square className="absolute inset-0 size-3" strokeWidth={1.5} />
            <Square className="absolute bottom-0 right-0 size-2 translate-x-0.5 translate-y-0.5" strokeWidth={1.5} />
          </span>
        ) : (
          <Square className="size-3" strokeWidth={1.5} />
        )}
      </WinBtn>
      <WinBtn label="Close" onClick={() => api.closeWindow?.()} className="hover:bg-destructive hover:text-destructive-foreground">
        <X className="size-3.5" strokeWidth={1.5} />
      </WinBtn>
    </div>
  );

  return (
    <header
      className="titlebar surface-chrome flex h-8 shrink-0 items-stretch select-none"
      onDoubleClick={onDoubleClick}
    >
      {isMac ? controls : null}
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <img src="/patchline-icon.png" alt="" className="titlebar-no-drag size-4 rounded-full" draggable={false} />
        <span className="truncate text-[12px] font-semibold tracking-tight text-foreground">Patchline</span>
      </div>
      {!isMac ? controls : null}
    </header>
  );
}

function WinBtn({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "titlebar-no-drag inline-flex w-11 items-center justify-center text-muted-foreground transition-colors",
        className,
      )}
    >
      {children}
    </button>
  );
}
