export type AgentEvent = {
  type: string;
  text?: string;
  name?: string;
  message?: string;
  path?: string;
  op?: string;
  args?: Record<string, unknown>;
  steps?: unknown[];
  nodes?: unknown[];
  edges?: unknown[];
  walkIds?: string[];
  anchorId?: string;
  todos?: { id?: string; content?: string; status?: string }[];
  questions?: { id?: string; prompt?: string; options?: string[] }[];
  markdown?: string;
  title?: string;
  version?: number;
  body?: string;
  rationale?: string;
  status?: string;
};

export type HarnessApi = {
  platform?: "win32" | "darwin" | "linux";
  minimizeWindow?: () => Promise<void>;
  maximizeWindow?: () => Promise<void>;
  closeWindow?: () => Promise<void>;
  isWindowMaximized?: () => Promise<boolean>;
  onWindowMaximized?: (cb: (maximized: boolean) => void) => () => void;
  tree: () => Promise<{ tree: unknown[] }>;
  gitStatus: () => Promise<{ files: Record<string, string> }>;
  read: (rel: string) => Promise<{ path: string; content: string }>;
  write: (rel: string, content: string) => Promise<{ ok: boolean }>;
  graph: (query: string) => Promise<{
    nodes?: unknown[];
    edges?: unknown[];
    walkIds?: string[];
    anchorId?: string;
  }>;
  diffs: () => Promise<{ diffs: { path: string; before: string; after: string }[] }>;
  rejectDiffs: (rel?: string) => Promise<{ ok: boolean; path?: string }>;
  skillTrace?: (rel: string, task?: string) => Promise<{ ok?: boolean; skill?: AgentEvent }>;
  skillReview?: (opts: { name: string; version: number; approve: boolean; reason?: string }) => Promise<{ ok?: boolean; status?: string }>;
  skillsPending?: () => Promise<{ ok?: boolean; skills?: AgentEvent[] }>;
  planAnswer?: (opts: { id: string; answers: Record<string, string> }) => Promise<{ ok: boolean }>;
  pickWorkspace: () => Promise<{ root: string }>;
  agentCaps?: () => Promise<{ images: boolean; visionModel?: string | null; model?: string }>;
  startAgent: (prompt: string, opts?: { history?: { role: string; text: string }[]; mode?: string; images?: { mime: string; data: string }[] }) => Promise<{ ok: boolean; error?: string }>;
  abortAgent: () => Promise<{ ok: boolean }>;
  onAgentEvent: (cb: (ev: AgentEvent) => void) => () => void;
  termOpen: (size?: { cols: number; rows: number }) => Promise<{ ok: boolean }>;
  termResize?: (size: { cols: number; rows: number }) => void;
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
