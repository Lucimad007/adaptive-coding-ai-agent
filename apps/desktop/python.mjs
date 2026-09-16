import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./workspace.mjs";

export function pythonBin() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const win = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
  const unix = path.join(REPO_ROOT, ".venv", "bin", "python");
  if (process.platform === "win32" && fs.existsSync(win)) return win;
  if (fs.existsSync(unix)) return unix;
  if (fs.existsSync(win)) return win;
  return "python";
}
