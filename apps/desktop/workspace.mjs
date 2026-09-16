import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");

let currentRoot = path.resolve(process.env.WORKSPACE_ROOT || REPO_ROOT);

export function workspaceRoot() {
  return currentRoot;
}

export function setWorkspaceRoot(next) {
  currentRoot = path.resolve(next);
  return currentRoot;
}

export function resolveSafe(rel, root = workspaceRoot()) {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("\0") || cleaned.split("/").some((p) => p === "..")) {
    throw new Error("path traversal rejected");
  }
  const abs = path.resolve(root, cleaned);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error("path traversal rejected");
  }
  return abs;
}

export const SKIP = new Set([".git", ".venv", "node_modules", ".next", "dist", "__pycache__", "release", ".pytest_cache"]);

export function tree(dir = workspaceRoot(), rel = "", depth = 0) {
  if (depth > 6) return [];
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const abs = path.join(dir, name);
    const childRel = rel ? `${rel}/${name}` : name;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      entries.push({
        path: childRel.replace(/\\/g, "/"),
        name,
        kind: "dir",
        children: tree(abs, childRel, depth + 1),
      });
    } else {
      entries.push({ path: childRel.replace(/\\/g, "/"), name, kind: "file" });
    }
  }
  return entries;
}

export function readFile(rel) {
  return fs.readFileSync(resolveSafe(rel), "utf8");
}

export function writeFile(rel, content) {
  const abs = resolveSafe(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}
