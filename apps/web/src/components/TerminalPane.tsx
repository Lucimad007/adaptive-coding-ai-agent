import { useEffect, useRef } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

export default function TerminalPane() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !window.harness) return;

    let disposed = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ro: ResizeObserver | null = null;
    let started = false;
    const pending: string[] = [];

    const off = window.harness.onTermData((data) => {
      if (!term) {
        pending.push(data);
        return;
      }
      term.write(data);
    });

    const measure = () => {
      if (!term || !fit || host.clientWidth < 20 || host.clientHeight < 20) return null;
      try {
        fit.fit();
      } catch {
        return null;
      }
      if (term.cols < 8 || term.rows < 2) return null;
      return { cols: term.cols, rows: term.rows };
    };

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");
      if (disposed || !hostRef.current) return;

      const t = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
        theme: {
          background: "#121212",
          foreground: "#f5f5f5",
          cursor: "#f0c14b",
          selectionBackground: "#3a3018",
        },
        scrollback: 5000,
        allowProposedApi: true,
        windowsMode: false,
        windowsPty:
          window.harness.platform === "win32"
            ? { backend: "conpty", buildNumber: 22621 }
            : undefined,
        macOptionIsMeta: false,
        overviewRulerWidth: 0,
      });
      const f = new FitAddon();
      t.loadAddon(f);
      t.open(host);
      term = t;
      fit = f;
      for (const chunk of pending) t.write(chunk);
      pending.length = 0;
      t.onData((d) => window.harness.termData(d));

      const boot = async () => {
        if (disposed || started) return;
        const size = measure();
        if (!size) return;
        started = true;
        await window.harness.termOpen(size);
        t.focus();
      };

      ro = new ResizeObserver(() => {
        const size = measure();
        if (size && started) window.harness.termResize?.(size);
        void boot();
      });
      ro.observe(host);
      host.addEventListener("mousedown", () => t.focus());
      requestAnimationFrame(() => void boot());
    })();

    return () => {
      disposed = true;
      off?.();
      ro?.disconnect();
      window.harness.termClose();
      term?.dispose();
    };
  }, []);

  return <div ref={hostRef} className="patchline-terminal" data-testid="terminal" />;
}
