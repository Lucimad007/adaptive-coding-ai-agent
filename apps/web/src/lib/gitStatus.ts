import type { FileEntry } from "./fileEntry";

export type GitStatus = "clean" | "modified" | "untracked" | "added" | "deleted" | "renamed";

const RANK: Record<GitStatus, number> = {
  clean: 0,
  untracked: 1,
  added: 2,
  renamed: 2,
  modified: 3,
  deleted: 4,
};

function mergeStatus(current: GitStatus, next: GitStatus): GitStatus {
  return RANK[next] > RANK[current] ? next : current;
}

/** Bubble git status to ancestor folders (Cursor-style explorer colors). */
export function buildGitLabels(tree: FileEntry[], files: Record<string, GitStatus>): Record<string, GitStatus> {
  const labels: Record<string, GitStatus> = {};

  for (const [rel, status] of Object.entries(files)) {
    if (status === "clean") continue;
    labels[rel] = mergeStatus(labels[rel] || "clean", status);
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      labels[dir] = mergeStatus(labels[dir] || "clean", status);
    }
  }

  function walk(entries: FileEntry[]) {
    for (const e of entries) {
      if (!labels[e.path]) labels[e.path] = "clean";
      if (e.children?.length) walk(e.children);
    }
  }
  walk(tree);
  return labels;
}

export function gitNameClass(status: GitStatus | undefined, active?: boolean) {
  if (active) return "text-accent-foreground";
  switch (status) {
    case "modified":
      return "text-[#e2b340]";
    case "untracked":
      return "text-[#4fc1ff]";
    case "added":
      return "text-[#3fb950]";
    case "deleted":
      return "text-[#f85149] line-through opacity-75";
    case "renamed":
      return "text-[#4fc1ff]";
    default:
      return "text-muted-foreground";
  }
}

export function gitStatusTitle(status: GitStatus | undefined) {
  if (!status || status === "clean") return undefined;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Cursor-style file badge letter (M, U, …). */
export function gitStatusLetter(status: GitStatus | undefined): string | null {
  switch (status) {
    case "modified":
      return "M";
    case "untracked":
      return "U";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return null;
  }
}

export function gitStatusAccentClass(status: GitStatus | undefined) {
  switch (status) {
    case "modified":
      return "text-[#e2b340]";
    case "untracked":
      return "text-[#4fc1ff]";
    case "added":
      return "text-[#3fb950]";
    case "deleted":
      return "text-[#f85149]";
    case "renamed":
      return "text-[#4fc1ff]";
    default:
      return "";
  }
}

export function gitStatusDotClass(status: GitStatus | undefined) {
  switch (status) {
    case "modified":
      return "bg-[#e2b340]";
    case "untracked":
      return "bg-[#4fc1ff]";
    case "added":
      return "bg-[#3fb950]";
    case "deleted":
      return "bg-[#f85149]";
    case "renamed":
      return "bg-[#4fc1ff]";
    default:
      return "";
  }
}
