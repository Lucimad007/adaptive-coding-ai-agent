export type PlanStep = {
  id: string;
  text: string;
  status: "pending" | "active" | "done";
};

export type GraphNode = {
  id: string;
  kind: string;
  label: string;
  path: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: string;
  weight: number;
};

export type FileDiff = {
  path: string;
  before: string;
  after: string;
};

export type FileEntry = {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: FileEntry[];
};

export type AgentEvent =
  | { type: "plan"; steps: PlanStep[] }
  | { type: "token"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; result?: string }
  | {
      type: "graph";
      nodes: GraphNode[];
      edges?: GraphEdge[];
      walkIds: string[];
      anchorId?: string;
    }
  | { type: "diff"; diffs: FileDiff[] }
  | { type: "error"; message: string }
  | { type: "done" };

export type WorkerIn =
  | { type: "start_run"; workspace: string; prompt: string }
  | { type: "abort" };

export type WorkerOut = AgentEvent;

export const IPC = {
  filesTree: "files:tree",
  filesRead: "files:read",
  filesWrite: "files:write",
  graphRetrieve: "graph:retrieve",
  diffsList: "diffs:list",
  diffsReject: "diffs:reject",
  workspacePick: "workspace:pick",
  agentStart: "agent:start",
  agentAbort: "agent:abort",
  agentEvent: "agent:event",
  termOpen: "term:open",
  termData: "term:data",
  termClose: "term:close",
} as const;
