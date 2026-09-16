export type AgentEvent = {
  type: string;
  text?: string;
  name?: string;
  message?: string;
  steps?: unknown[];
  nodes?: unknown[];
  edges?: unknown[];
  walkIds?: string[];
  anchorId?: string;
};

export type HarnessApi = {
  platform?: "win32" | "darwin" | "linux";
  minimizeWindow?: () => Promise<void>;
  maximizeWindow?: () => Promise<void>;
  closeWindow?: () => Promise<void>;
  isWindowMaximized?: () => Promise<boolean>;
  onWindowMaximized?: (cb: (maximized: boolean) => void) => () => void;
  tree: () => Promise<{ tree: unknown[] }>;
  read: (rel: string) => Promise<{ path: string; content: string }>;
  write: (rel: string, content: string) => Promise<{ ok: boolean }>;
  graph: (query: string) => Promise<{
    nodes?: unknown[];
    edges?: unknown[];
    walkIds?: string[];
    anchorId?: string;
  }>;
  diffs: () => Promise<{ diffs: { path: string; before: string; after: string }[] }>;
  rejectDiffs: () => Promise<{ ok: boolean }>;
  pickWorkspace: () => Promise<{ root: string }>;
  startAgent: (prompt: string) => Promise<{ ok: boolean }>;
  abortAgent: () => Promise<{ ok: boolean }>;
  onAgentEvent: (cb: (ev: AgentEvent) => void) => () => void;
  termOpen: () => void;
  termData: (chunk: string) => void;
  termClose: () => void;
  onTermData: (cb: (d: string) => void) => () => void;
};

declare global {
  interface Window {
    harness: HarnessApi;
  }
}

export {};
