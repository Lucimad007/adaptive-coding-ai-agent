import { useCallback, useEffect, useState, type ReactNode } from "react";
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
        <CaptionMinimize />
      </WinBtn>
      <WinBtn
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => api.maximizeWindow?.()}
        className="hover:bg-accent"
      >
        {maximized ? <CaptionRestore /> : <CaptionMaximize />}
      </WinBtn>
      <WinBtn label="Close" onClick={() => api.closeWindow?.()} className="hover:bg-destructive hover:text-destructive-foreground">
        <CaptionClose />
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

function CaptionMinimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h8" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CaptionMaximize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CaptionRestore() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 4h5v5H2z" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M4 4V2h5v5H7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CaptionClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
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
