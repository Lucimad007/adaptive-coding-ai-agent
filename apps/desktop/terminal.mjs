import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

/** @type {import("node-pty").IPty | null} */
let ptyProc = null;
let closing = false;

function loadPty() {
  const names = ["@homebridge/node-pty-prebuilt-multiarch", "node-pty"];
  for (const name of names) {
    try {
      return require(name);
    } catch {
      /* try next */
    }
  }
  return null;
}

const pty = loadPty();

function powershellPath() {
  const root = process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    "powershell.exe",
  ];
  for (const file of candidates) {
    if (file === "powershell.exe" || fs.existsSync(file)) return file;
  }
  return "powershell.exe";
}

export function ptyAvailable() {
  return Boolean(pty);
}

export function spawnShell({ cwd, cols = 80, rows = 24, onData, onExit }) {
  if (!pty) {
    throw new Error("PTY native module is not loaded. Install @homebridge/node-pty-prebuilt-multiarch.");
  }
  closeShell();
  closing = false;

  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Patchline",
  };

  const file = process.platform === "win32" ? powershellPath() : process.env.SHELL || "/bin/bash";
  const args = process.platform === "win32" ? ["-NoLogo"] : ["-l"];

  ptyProc = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: Math.max(8, cols),
    rows: Math.max(2, rows),
    cwd,
    env,
    useConpty: process.platform === "win32",
    conptyInheritCursor: false,
  });

  ptyProc.onData(onData);
  ptyProc.onExit(({ exitCode }) => {
    ptyProc = null;
    if (closing) {
      closing = false;
      return;
    }
    onExit?.(exitCode);
  });

  return { file };
}

export function writeShell(data) {
  ptyProc?.write(data);
}

export function resizeShell(cols, rows) {
  if (!ptyProc || cols < 2 || rows < 1) return;
  try {
    ptyProc.resize(cols, rows);
  } catch {
    /* ignore */
  }
}

export function closeShell() {
  if (!ptyProc) return;
  closing = true;
  try {
    ptyProc.kill();
  } catch {
    /* ignore */
  }
  ptyProc = null;
}
