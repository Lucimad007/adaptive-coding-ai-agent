import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Editor, { DiffEditor, type BeforeMount } from "@monaco-editor/react";
import { ArrowUp, FolderOpen, GitCompare, RotateCcw, Save, Square, X } from "lucide-react";
import FileTree, { type FileEntry } from "./FileTree";
import GraphPane from "./GraphPane";
import TerminalPane from "./TerminalPane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTypeIcon, monacoLanguage } from "@/lib/files";
import { cn } from "@/lib/utils";

type PlanStep = { id: string; text: string; status: string };
type ChatMsg = { id: string; role: "user" | "assistant" | "tool" | "error"; text: string };

function api() {
  return window.harness;
}

function planVariant(status: string) {
  if (status === "done") return "done" as const;
  if (status === "active") return "active" as const;
  return "pending" as const;
}

const monacoBeforeMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("harness-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955" },
      { token: "string", foreground: "CE9178" },
      { token: "keyword", foreground: "C586C0" },
      { token: "number", foreground: "B5CEA8" },
      { token: "type", foreground: "4EC9B0" },
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editor.foreground": "#d4d4d4",
      "editorLineNumber.foreground": "#6e6e6e",
      "editor.selectionBackground": "#264f78",
      "editor.lineHighlightBackground": "#2a2a2a",
    },
  });
};

const editorOptions = {
  fontFamily: "IBM Plex Mono, Cascadia Code, Consolas, monospace",
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  padding: { top: 8 },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  bracketPairColorization: { enabled: true },
  renderLineHighlight: "line" as const,
};

export default function Ide() {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>(["README.md"]);
  const [path, setPath] = useState("README.md");
  const [content, setContent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<ChatMsg[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [graph, setGraph] = useState<{
    nodes: unknown[];
    edges?: unknown[];
    walkIds: string[];
    anchorId?: string;
  } | null>(null);
  const [diffs, setDiffs] = useState<{ path: string; before: string; after: string }[]>([]);
  const [diffIdx, setDiffIdx] = useState(0);
  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const chatEnd = useRef<HTMLDivElement>(null);
  const lang = monacoLanguage(mode === "diff" && diffs[diffIdx] ? diffs[diffIdx].path : path);

  async function loadTree() {
    const data = await api().tree();
    setTree((data.tree || []) as FileEntry[]);
  }

  async function openFile(rel: string) {
    const data = await api().read(rel);
    setPath(rel);
    setContent(data.content ?? "");
    setMode("edit");
    setOpenTabs((tabs) => (tabs.includes(rel) ? tabs : [...tabs, rel]));
  }

  function closeTab(rel: string, e: MouseEvent) {
    e.stopPropagation();
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== rel);
      if (rel === path && next.length) openFile(next[next.length - 1]);
      return next;
    });
  }

  async function save() {
    await api().write(path, content);
  }

  async function loadDiffs() {
    const data = await api().diffs();
    setDiffs(data.diffs || []);
    setDiffIdx(0);
    if (data.diffs?.length) setMode("diff");
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
    const text = prompt.trim();
    if (!text) return;
    setLog((l) => [...l, { id: crypto.randomUUID(), role: "user", text }]);
    setPrompt("");
    loadGraph(text).catch(() => undefined);
    const off = api().onAgentEvent((ev) => {
      if (ev.type === "token") {
        setLog((l) => [...l, { id: crypto.randomUUID(), role: "assistant", text: String(ev.text) }]);
      }
      if (ev.type === "tool") {
        setLog((l) => [...l, { id: crypto.randomUUID(), role: "tool", text: `tool ${ev.name}` }]);
      }
      if (ev.type === "error") {
        setLog((l) => [...l, { id: crypto.randomUUID(), role: "error", text: String(ev.message) }]);
      }
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
    api().startAgent(text);
  }

  async function reject() {
    await api().rejectDiffs();
    await loadDiffs();
  }

  useEffect(() => {
    if (!window.harness) return;
    loadTree();
    openFile("README.md").catch(() => undefined);
    const off = api().onAgentEvent(() => undefined);
    return () => off();
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const currentDiff = diffs[diffIdx];
  const fileName = path.split("/").pop() || path;

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen flex-col overflow-hidden bg-[#181818] text-zinc-200">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={16} minSize={12} className="bg-[#181818]">
            <div className="flex h-8 items-center justify-between px-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Explorer</span>
              <ToolBtn label="Open folder" onClick={() => api().pickWorkspace().then(loadTree)}>
                <FolderOpen className="size-3.5" />
              </ToolBtn>
            </div>
            <ScrollArea className="h-[calc(100%-2rem)]">
              <FileTree entries={tree} onOpen={openFile} activePath={path} />
            </ScrollArea>
          </ResizablePanel>
          <ResizableHandle className="w-px bg-[#2b2b2b]" />
          <ResizablePanel defaultSize={56} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={78} minSize={40} className="flex flex-col bg-[#1e1e1e]">
                <div className="flex h-9 shrink-0 items-stretch border-b border-[#2b2b2b] bg-[#181818]">
                  {openTabs.map((t) => (
                    <button
                      key={t}
                      onClick={() => openFile(t)}
                      className={cn(
                        "group flex max-w-[180px] items-center gap-1.5 border-r border-[#2b2b2b] px-3 text-[12.5px]",
                        t === path && mode === "edit"
                          ? "bg-[#1e1e1e] text-zinc-100"
                          : "bg-[#181818] text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      <FileTypeIcon name={t.split("/").pop() || t} />
                      <span className="truncate">{t.split("/").pop()}</span>
                      <X
                        className="size-3 opacity-0 group-hover:opacity-70"
                        onClick={(e) => closeTab(t, e)}
                      />
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-0.5 px-2">
                    <ToolBtn label="Save" onClick={save}>
                      <Save className="size-3.5" />
                    </ToolBtn>
                    <ToolBtn label="Review diffs" onClick={loadDiffs}>
                      <GitCompare className="size-3.5" />
                    </ToolBtn>
                    <ToolBtn label="Reject writes" onClick={reject}>
                      <RotateCcw className="size-3.5" />
                    </ToolBtn>
                    <Button
                      size="sm"
                      variant={mode === "diff" ? "secondary" : "ghost"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setMode(mode === "edit" ? "diff" : "edit")}
                    >
                      {mode === "diff" ? "Edit" : "Review"}
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  {mode === "edit" ? (
                    <Editor
                      height="100%"
                      theme="harness-dark"
                      path={path}
                      language={lang}
                      value={content}
                      beforeMount={monacoBeforeMount}
                      onChange={(v) => setContent(v || "")}
                      options={editorOptions}
                    />
                  ) : currentDiff ? (
                    <div className="flex h-full flex-col">
                      <div className="flex gap-1 overflow-x-auto border-b border-[#2b2b2b] px-2 py-1">
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
                      <div className="min-h-0 flex-1">
                        <DiffEditor
                          height="100%"
                          theme="harness-dark"
                          language={monacoLanguage(currentDiff.path)}
                          original={currentDiff.before}
                          modified={currentDiff.after}
                          beforeMount={monacoBeforeMount}
                          options={{ ...editorOptions, renderSideBySide: true, fontSize: 12 }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                      No uncommitted diffs
                    </div>
                  )}
                </div>
              </ResizablePanel>
              <ResizableHandle className="h-px bg-[#2b2b2b]" />
              <ResizablePanel defaultSize={22} minSize={10} className="bg-[#1e1e1e]">
                <div className="border-b border-[#2b2b2b] px-3 py-1 text-[11px] text-zinc-500">Terminal</div>
                <div className="h-[calc(100%-28px)]">
                  <TerminalPane />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle className="w-px bg-[#2b2b2b]" />
          <ResizablePanel defaultSize={28} minSize={20} className="flex flex-col bg-[#1a1a1a]">
            <Tabs defaultValue="chat" className="flex h-full flex-col">
              <div className="flex h-9 items-center border-b border-[#2b2b2b] px-2">
                <TabsList className="h-7 bg-transparent">
                  <TabsTrigger value="chat" className="text-[12px]">
                    Chat
                  </TabsTrigger>
                  <TabsTrigger value="graph" className="text-[12px]">
                    Graph
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col">
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-3 px-3 py-3">
                    {fileName ? (
                      <p className="text-[11px] text-zinc-500">
                        Context · <span className="font-mono text-zinc-400">{fileName}</span>
                      </p>
                    ) : null}
                    {plan.length > 0 ? (
                      <ul className="space-y-1.5 rounded-md border border-[#2b2b2b] bg-[#141414] p-2">
                        {plan.map((s) => (
                          <li key={s.id} className="flex items-start gap-2 text-xs">
                            <Badge variant={planVariant(s.status)}>{s.status}</Badge>
                            <span className="leading-5 text-zinc-300">{s.text}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {log.length === 0 ? (
                      <p className="text-sm leading-6 text-zinc-500">
                        Ask the coding agent about this workspace. Retrieval uses the code graph on the Graph tab.
                      </p>
                    ) : (
                      log.map((m) => (
                        <div
                          key={m.id}
                          className={cn(
                            "rounded-lg px-3 py-2 text-[13px] leading-6",
                            m.role === "user" && "ml-6 bg-[#2a2a2a] text-zinc-100",
                            m.role === "assistant" && "mr-2 text-zinc-200",
                            m.role === "tool" && "font-mono text-[11px] text-zinc-500",
                            m.role === "error" && "text-red-400",
                          )}
                        >
                          {m.text}
                        </div>
                      ))
                    )}
                    <div ref={chatEnd} />
                  </div>
                </ScrollArea>
                <div className="border-t border-[#2b2b2b] p-3">
                  <div className="relative rounded-xl border border-[#333] bg-[#141414] focus-within:border-zinc-500">
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          runAgent();
                        }
                      }}
                      placeholder="Plan, search the graph, or edit files…"
                      className="min-h-[72px] resize-none border-0 bg-transparent pr-10 text-[13px] shadow-none focus-visible:ring-0"
                    />
                    <div className="absolute bottom-2 right-2 flex gap-1">
                      <Button
                        size="icon"
                        className="h-7 w-7 rounded-lg"
                        onClick={runAgent}
                        disabled={!prompt.trim()}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => api().abortAgent()}>
                        <Square className="size-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="graph" className="mt-0 min-h-0 flex-1">
                <GraphPane payload={graph} />
              </TabsContent>
            </Tabs>
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
        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
