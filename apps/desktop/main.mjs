import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { pythonBin } from "./python.mjs";
import { closeShell, ptyAvailable, resizeShell, spawnShell, writeShell } from "./terminal.mjs";
import {
  REPO_ROOT,
  SKIP,
  readFile,
  resolveSafe,
  setWorkspaceRoot,
  tree,
  workspaceRoot,
  writeFile,
} from "./workspace.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-features", "WindowsScrollingPersonality");
}

const iconPath = path.join(here, "build", "icon.png");
const appIcon = nativeImage.createFromPath(iconPath);

if (process.platform === "win32") {
  app.setAppUserModelId("dev.patchline.app");
}

let win = null;
let agentProc = null;
let termSender = null;

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin(), ["-m", "adaptive_agent.harness_worker", ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `worker exit ${code}`));
      else resolve(out);
    });
  });
}

function spawnGit(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["-c", "core.quotepath=false", ...args], {
      cwd: workspaceRoot(),
      windowsHide: true,
    });
    let out = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`git ${args[0]} ${code}`))));
    proc.on("error", reject);
  });
}

function cleanGitPath(raw) {
  let rel = raw.trim().replace(/\\/g, "/");
  if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
  if (rel.includes(" -> ")) rel = rel.split(" -> ").pop().trim();
  return rel;
}

function skipDiffPath(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => SKIP.has(p))) return true;
  if (rel.startsWith("data/eval/")) return true;
  if (rel.startsWith("apps/web/dist/")) return true;
  return false;
}

async function gitChangedPaths() {
  const files = await gitStatusFiles();
  return Object.keys(files)
    .filter((rel) => !skipDiffPath(rel))
    .slice(0, 40);
}

async function gitDiffs() {
  const files = await gitChangedPaths();
  const diffs = [];
  for (const rel of files) {
    let before = "";
    try {
      before = await gitShow(`HEAD:${rel}`);
    } catch {
      before = "";
    }
    let after = "";
    try {
      after = readFile(rel);
    } catch {
      after = "";
    }
    if (before.length > 400_000 || after.length > 400_000) continue;
    diffs.push({ path: rel, before, after });
  }
  return diffs;
}

async function revertWorkspaceFile(rel) {
  const abs = resolveSafe(rel);
  let tracked = false;
  try {
    await spawnGit(["cat-file", "-e", `HEAD:${rel.replace(/\\/g, "/")}`]);
    tracked = true;
  } catch {
    tracked = false;
  }
  if (tracked) {
    await spawnGit(["checkout", "HEAD", "--", rel.replace(/\\/g, "/")]);
    return;
  }
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) fs.unlinkSync(abs);
}

function gitShow(spec) {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["show", spec], { cwd: workspaceRoot(), windowsHide: true });
    let out = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error("git show"))));
  });
}

function gitStatusFiles() {
  return new Promise((resolve) => {
    const cwd = workspaceRoot();
    const proc = spawn("git", ["status", "--porcelain", "-uall"], { cwd });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({});
        return;
      }
      const files = {};
      for (const line of out.split(/\r?\n/)) {
        if (line.length < 4) continue;
        const xy = line.slice(0, 2);
        let rel = cleanGitPath(line.slice(3));
        const staged = xy[0];
        const unstaged = xy[1];
        if (staged === "!" || unstaged === "!") continue;
        let status = "modified";
        if (staged === "?" && unstaged === "?") status = "untracked";
        else if (staged === "D" || unstaged === "D") status = "deleted";
        else if (staged === "A" || unstaged === "A") status = "added";
        else if (staged === "R" || unstaged === "R") status = "renamed";
        else if (staged === "M" || unstaged === "M") status = "modified";
        files[rel] = status;
      }
      resolve(files);
    });
    proc.on("error", () => resolve({}));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Patchline",
    icon: appIcon.isEmpty() ? iconPath : appIcon,
    frame: false,
    backgroundColor: "#161616",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });
  const devUrl = process.env.ELECTRON_START_URL || "http://127.0.0.1:5173";
  if (!app.isPackaged) {
    win.loadURL(devUrl);
  } else {
    const index = path.join(process.resourcesPath, "renderer", "index.html");
    win.loadFile(index);
  }
  const sendMax = () => win?.webContents.send("window:maximized", win.isMaximized());
  win.on("maximize", sendMax);
  win.on("unmaximize", sendMax);
}

ipcMain.handle("files:tree", () => ({ tree: tree() }));
ipcMain.handle("git:status", async () => ({ files: await gitStatusFiles() }));
ipcMain.handle("files:read", (_e, rel) => ({ path: rel, content: readFile(rel) }));
ipcMain.handle("files:write", (_e, rel, content) => {
  writeFile(rel, content);
  return { ok: true, path: rel };
});
ipcMain.handle("graph:get", async () => {
  const raw = await runWorker(["graph", "--workspace", workspaceRoot()]);
  return JSON.parse(raw);
});
ipcMain.handle("graph:retrieve", async (_e, query) => {
  const args = query
    ? ["retrieve", "--query", query, "--workspace", workspaceRoot()]
    : ["graph", "--workspace", workspaceRoot()];
  const raw = await runWorker(args);
  return JSON.parse(raw);
});
ipcMain.handle("diffs:list", async () => ({ diffs: await gitDiffs() }));
ipcMain.handle("diffs:reject", async (_e, rel) => {
  if (rel) {
    await revertWorkspaceFile(rel);
    return { ok: true, path: rel };
  }
  const files = await gitChangedPaths();
  for (const file of files) {
    try {
      await revertWorkspaceFile(file);
    } catch {
      /* skip */
    }
  }
  return { ok: true };
});
ipcMain.handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return { root: workspaceRoot() };
  setWorkspaceRoot(result.filePaths[0]);
  return { root: workspaceRoot() };
});
ipcMain.handle("agent:start", (_e, prompt, opts = {}) => {
  const prev = agentProc;
  if (prev) {
    prev.kill();
    agentProc = null;
  }
  const proc = spawn(pythonBin(), ["-m", "adaptive_agent.harness_worker", "run"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONPATH: REPO_ROOT, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
  });
  agentProc = proc;
  let stdoutBuf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        win?.webContents.send("agent:event", JSON.parse(line));
      } catch {
        win?.webContents.send("agent:event", { type: "token", text: line });
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (!text.trim()) return;
    if (/traceback/i.test(text) || /error:/i.test(text) || /Error/i.test(text)) {
      win?.webContents.send("agent:event", { type: "error", message: text });
    }
  });
  proc.on("error", (err) => {
    win?.webContents.send("agent:event", { type: "error", message: String(err) });
    win?.webContents.send("agent:event", { type: "done" });
  });
  proc.on("close", () => {
    if (agentProc === proc) {
      win?.webContents.send("agent:event", { type: "done" });
      agentProc = null;
    }
  });
  const payload = JSON.stringify({
    type: "start_run",
    workspace: workspaceRoot(),
    prompt,
    history: Array.isArray(opts.history)
      ? opts.history.map((h) => ({
          role: h.role,
          text: String(h.text || "").replace(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
            "\uFFFD",
          ),
        }))
      : [],
    mode: opts.mode || "agent",
  });
  win?.webContents.send("agent:event", { type: "status", text: "running" });
  proc.stdin.write(payload + "\n", "utf8", () => {
    try {
      proc.stdin.end();
    } catch {
      /* already closed */
    }
  });
  return { ok: true };
});
ipcMain.handle("agent:abort", () => {
  agentProc?.kill();
  agentProc = null;
  return { ok: true };
});

ipcMain.handle("term:open", (event, size = {}) => {
  closeShell();
  termSender = event.sender;
  const cols = Math.max(8, Number(size.cols) || 80);
  const rows = Math.max(2, Number(size.rows) || 24);
  const send = (d) => termSender?.send("term:data", d);
  if (!ptyAvailable()) {
    send(
      "\x1b[31mPTY not loaded.\x1b[0m Quit Patchline, then:\r\n  npm install --workspace=@harness/desktop\r\n",
    );
    return { ok: false };
  }
  try {
    spawnShell({
      cwd: workspaceRoot(),
      cols,
      rows,
      onData: send,
      onExit: (code) => send(`\r\n[shell exited ${code ?? 0}]\r\n`),
    });
    return { ok: true, pty: true };
  } catch (err) {
    send(`\x1b[31m[terminal] ${err.message}\x1b[0m\r\n`);
    return { ok: false };
  }
});
ipcMain.on("term:resize", (_e, size = {}) => {
  resizeShell(Math.max(8, Number(size.cols) || 80), Math.max(2, Number(size.rows) || 24));
});
ipcMain.on("term:data", (_e, chunk) => {
  writeShell(typeof chunk === "string" ? chunk : String(chunk));
});
ipcMain.on("term:close", () => {
  closeShell();
  termSender = null;
});

ipcMain.handle("window:minimize", () => {
  win?.minimize();
});
ipcMain.handle("window:maximize", () => {
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.handle("window:close", () => {
  win?.close();
});
ipcMain.handle("window:isMaximized", () => win?.isMaximized() ?? false);

app.whenReady().then(() => {
  if (!appIcon.isEmpty() && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(appIcon);
  }
  createWindow();
});
app.on("window-all-closed", () => app.quit());
