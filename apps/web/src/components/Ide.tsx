import { useEffect, useState, type ReactNode } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  FolderOpen,
  GitCompare,
  Play,
  RotateCcw,
  Save,
  Square,
} from "lucide-react";
import FileTree, { type FileEntry } from "./FileTree";
import GraphPane from "./GraphPane";
import TerminalPane from "./TerminalPane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type PlanStep = { id: string; text: string; status: string };

function api() {
  return window.harness;
}

function planVariant(status: string) {
  if (status === "done") return "done" as const;
  if (status === "active") return "active" as const;
  return "pending" as const;
}

export default function Ide() {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [path, setPath] = useState("README.md");
  const [content, setContent] = useState("");
  const [prompt, setPrompt] = useState("Add a docstring to get_feed in fixtures/sample_codebase/app.py");
  const [log, setLog] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [graph, setGraph] = useState<{
    nodes: unknown[];
    edges?: unknown[];
    walkIds: string[];
    anchorId?: string;
  } | null>(null);
  const [diffs, setDiffs] = useState<{ path: string; before: string; after: string }[]>([]);
  const [diffIdx, setDiffIdx] = useState(0);
  const [tab, setTab] = useState<"edit" | "diff">("edit");

  async function loadTree() {
    const data = await api().tree();
    setTree((data.tree || []) as FileEntry[]);
  }

  async function openFile(rel: string) {
    const data = await api().read(rel);
    setPath(rel);
    setContent(data.content ?? "");
    setTab("edit");
  }

  async function save() {
    await api().write(path, content);
  }

  async function loadDiffs() {
    const data = await api().diffs();
    setDiffs(data.diffs || []);
    setDiffIdx(0);
    if (data.diffs?.length) setTab("diff");
  }

  async function loadGraph(q: string) {
    const data = await api().graph(q);
    setGraph({
      nodes: data.nodes || [],
      edges: data.edges || [],
      walkIds: data.walkIds || [],
      anchorId: data.anchorId,
    });
  }

  function runAgent() {
    loadGraph(prompt).catch(() => undefined);
    const off = api().onAgentEvent((ev) => {
      if (ev.type === "token") setLog((l) => [...l, String(ev.text)]);
      if (ev.type === "tool") setLog((l) => [...l, `tool ${ev.name}`]);
      if (ev.type === "error") setLog((l) => [...l, `error ${ev.message}`]);
      if (ev.type === "plan") setPlan((ev.steps as PlanStep[]) || []);
      if (ev.type === "graph") {
        setGraph({
          nodes: (ev.nodes as unknown[]) || [],
          edges: (ev.edges as unknown[]) || [],
          walkIds: (ev.walkIds as string[]) || [],
          anchorId: ev.anchorId as string | undefined,
        });
      }
      if (ev.type === "done") {
        loadDiffs();
        off();
      }
    });
    api().startAgent(prompt);
  }

  async function reject() {
    await api().rejectDiffs();
    await loadDiffs();
  }

  useEffect(() => {
    if (!window.harness) return;
    loadTree();
    openFile("README.md").catch(() => undefined);
    loadGraph(prompt).catch(() => undefined);
    const off = api().onAgentEvent(() => undefined);
    return () => off();
  }, []);

  const currentDiff = diffs[diffIdx];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <span className="text-[13px] font-medium tracking-tight">Harness</span>
          <Separator orientation="vertical" className="h-4" />
          <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
          <div className="ml-auto flex items-center gap-1">
            <ToolBtn label="Open folder" onClick={() => api().pickWorkspace().then(loadTree)}>
              <FolderOpen />
            </ToolBtn>
            <ToolBtn label="Save" onClick={save}>
              <Save />
            </ToolBtn>
            <ToolBtn label="Reload diffs" onClick={loadDiffs}>
              <GitCompare />
            </ToolBtn>
            <ToolBtn label="Reject writes" onClick={reject}>
              <RotateCcw />
            </ToolBtn>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Tabs value={tab} onValueChange={(v) => setTab(v as "edit" | "diff")}>
              <TabsList>
                <TabsTrigger value="edit">Edit</TabsTrigger>
                <TabsTrigger value="diff">Review{diffs.length ? ` (${diffs.length})` : ""}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </header>

        <ResizablePanelGroup direction="vertical" className="flex-1">
          <ResizablePanel defaultSize={78} minSize={40}>
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={18} minSize={12} className="bg-card/40">
                <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Explorer
                </div>
                <ScrollArea className="h-[calc(100%-2rem)]">
                  <FileTree entries={tree} onOpen={openFile} activePath={path} />
                </ScrollArea>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={54} minSize={30}>
                <ResizablePanelGroup direction="vertical">
                  <ResizablePanel defaultSize={68} minSize={30}>
                    {tab === "edit" ? (
                      <Editor
                        height="100%"
                        theme="vs-dark"
                        path={path}
                        value={content}
                        onChange={(v) => setContent(v || "")}
                        options={{ fontFamily: "IBM Plex Mono", fontSize: 13, minimap: { enabled: false }, padding: { top: 8 } }}
                      />
                    ) : currentDiff ? (
                      <div className="flex h-full flex-col">
                        <ScrollArea className="h-9 shrink-0 border-b">
                          <div className="flex gap-1 px-2 py-1">
                            {diffs.map((d, i) => (
                              <Button
                                key={d.path}
                                size="sm"
                                variant={i === diffIdx ? "secondary" : "ghost"}
                                className="h-6 font-mono text-[11px]"
                                onClick={() => setDiffIdx(i)}
                              >
                                {d.path}
                              </Button>
                            ))}
                          </div>
                        </ScrollArea>
                        <div className="min-h-0 flex-1">
                          <DiffEditor
                            height="100%"
                            theme="vs-dark"
                            original={currentDiff.before}
                            modified={currentDiff.after}
                            options={{ fontFamily: "IBM Plex Mono", fontSize: 12, renderSideBySide: true }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        No uncommitted diffs
                      </div>
                    )}
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={32} minSize={18} className="flex flex-col">
                    <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Agent
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
                      <Textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="min-h-[64px] resize-none font-mono text-xs"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={runAgent} className="gap-1.5">
                          <Play className="size-3.5" />
                          Run
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => api().abortAgent()}>
                          <Square className="size-3.5" />
                          Stop
                        </Button>
                      </div>
                      <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/30">
                        <pre className="whitespace-pre-wrap p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {log.slice(-16).join("\n") || "Output appears here."}
                        </pre>
                      </ScrollArea>
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={28} minSize={16} className="flex flex-col bg-card/30">
                <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Plan
                </div>
                <ScrollArea className="h-40 border-b px-3 pb-2">
                  {plan.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Steps show up when a run starts.</p>
                  ) : (
                    <ul className="space-y-2">
                      {plan.map((s) => (
                        <li key={s.id} className="flex items-start gap-2 text-xs">
                          <Badge variant={planVariant(s.status)}>{s.status}</Badge>
                          <span className="leading-5">{s.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
                <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Code graph
                </div>
                <div className="min-h-0 flex-1">
                  <GraphPane payload={graph} />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={22} minSize={12} className="bg-[#111113]">
            <div className="border-b px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Terminal
            </div>
            <div className="h-[calc(100%-28px)]">
              <TerminalPane />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  );
}

function ToolBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
