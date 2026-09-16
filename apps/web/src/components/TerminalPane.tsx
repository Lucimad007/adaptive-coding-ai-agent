import { useEffect, useRef } from "react";

export default function TerminalPane() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !window.harness) return;
    let term: { dispose: () => void; write: (s: string) => void; onData: (cb: (d: string) => void) => void } | null =
      null;
    const off = window.harness.onTermData((d) => term?.write(d.replace(/\n/g, "\r\n")));
    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      await import("@xterm/xterm/css/xterm.css");
      const t = new Terminal({
        fontSize: 12,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        theme: {
          background: "#111113",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "#3f3f46",
        },
      });
      t.open(ref.current!);
      term = t;
      window.harness.termOpen();
      t.onData((d) => window.harness.termData(d));
    })();
    return () => {
      off?.();
      window.harness.termClose();
      term?.dispose();
    };
  }, []);

  return <div ref={ref} className="h-full w-full p-2" />;
}
