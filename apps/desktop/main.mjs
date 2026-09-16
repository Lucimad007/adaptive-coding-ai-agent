import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { pythonBin } from "./python.mjs";
import {
  REPO_ROOT,
  readFile,
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

let win = null;
let agentProc = null;
let shellProc = null;

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

function gitDiffs() {
  return new Promise((resolve) => {
    const cwd = workspaceRoot();
    const proc = spawn("git", ["diff", "--name-only", "HEAD"], { cwd });
    let names = "";
    proc.stdout.on("data", (d) => (names += d.toString()));
    proc.on("close", async () => {
      const files = names.split(/\r?\n/).filter(Boolean).slice(0, 20);
      const diffs = [];
      for (const file of files) {
        const rel = file.replace(/\\/g, "/");
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
        diffs.push({ path: rel, before, after });
      }
      resolve(diffs);
    });
  });
}

function gitShow(spec) {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["show", spec], { cwd: workspaceRoot() });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error("git show"))));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
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
}

ipcMain.handle("files:tree", () => ({ tree: tree() }));
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
ipcMain.handle("diffs:reject", () => {
  return new Promise((resolve) => {
    const proc = spawn("git", ["checkout", "--", "."], { cwd: workspaceRoot() });
    proc.on("close", () => resolve({ ok: true }));
  });
});
ipcMain.handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return { root: workspaceRoot() };
  setWorkspaceRoot(result.filePaths[0]);
  return { root: workspaceRoot() };
});
ipcMain.handle("agent:start", (_e, prompt) => {
  if (agentProc) {
    agentProc.kill();
    agentProc = null;
  }
  const proc = spawn(pythonBin(), ["-m", "adaptive_agent.harness_worker", "run"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONPATH: REPO_ROOT },
  });
  agentProc = proc;
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
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
    win?.webContents.send("agent:event", { type: "error", message: chunk });
  });
  proc.on("close", () => {
    win?.webContents.send("agent:event", { type: "done" });
    agentProc = null;
  });
  proc.stdin.write(
    JSON.stringify({ type: "start_run", workspace: workspaceRoot(), prompt }) + "\n",
  );
  return { ok: true };
});
ipcMain.handle("agent:abort", () => {
  agentProc?.kill();
  agentProc = null;
  return { ok: true };
});

ipcMain.on("term:open", (event) => {
  shellProc?.kill();
  const shell = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = process.platform === "win32" ? ["-NoLogo"] : [];
  const proc = spawn(shell, args, { cwd: workspaceRoot(), env: process.env });
  shellProc = proc;
  proc.stdout.on("data", (d) => event.sender.send("term:data", d.toString()));
  proc.stderr.on("data", (d) => event.sender.send("term:data", d.toString()));
  proc.on("close", () => event.sender.send("term:data", "\r\n[shell exited]\r\n"));
});
ipcMain.on("term:data", (_e, chunk) => {
  shellProc?.stdin.write(chunk);
});
ipcMain.on("term:close", () => {
  shellProc?.kill();
  shellProc = null;
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
