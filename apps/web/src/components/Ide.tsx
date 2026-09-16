import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Editor, { DiffEditor, type BeforeMount, type Monaco } from "@monaco-editor/react";
import {
  ArrowUp,
  BookOpen,
  Code2,
  FolderOpen,
  GitCompare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Save,
  Square,
  X,
} from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import ChatMarkdown from "./ChatMarkdown";
import FileTree, { type FileEntry } from "./FileTree";
import GraphPane from "./GraphPane";
import TerminalPane from "./TerminalPane";
import TitleBar from "./TitleBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTypeIcon, monacoLanguage } from "@/lib/files";
import { buildGitLabels, type GitStatus } from "@/lib/gitStatus";
import { configureMonacoTs, ensureModel, warmMonacoImports } from "@/lib/monacoWorkspace";
import { cn } from "@/lib/utils";

type PlanStep = { id: string; text: string; status: string };
type ChatMsg = { id: string; role: "user" | "assistant" | "tool" | "error"; text: string; streaming?: boolean };
type ChatSession = { id: string; title: string; log: ChatMsg[]; plan: PlanStep[] };

function newSession(partial?: Partial<ChatSession>): ChatSession {
  return { id: crypto.randomUUID(), title: "New chat", log: [], plan: [], ...partial };
}

function api() {
  return window.harness;
}

function planVariant(status: string) {
  if (status === "done") return "done" as const;
  if (status === "active") return "active" as const;
  return "pending" as const;
}

const monacoBeforeMount: BeforeMount = (monaco) => {
  configureMonacoTs(monaco);
  monacoRef = monaco;
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
      "editor.foreground": "#f5f5f5",
      "editorLineNumber.foreground": "#8a8a8a",
      "editor.selectionBackground": "#3a3018",
      "editor.lineHighlightBackground": "#262626",
      "scrollbarSlider.background": "#5a5a5a66",
      "scrollbarSlider.hoverBackground": "#8a8a8a99",
      "scrollbarSlider.activeBackground": "#c8c8c8aa",
      "editorWidget.background": "#222222",
      "editorWidget.border": "#2a2a2a",
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
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    verticalSliderSize: 6,
    horizontalSliderSize: 6,
  },
};

function isMarkdown(rel: string) {
  return /\.md$/i.test(rel) || /^readme(\.|$)/i.test(rel.split(/[/\\]/).pop() || "");
}

let monacoRef: Monaco | null = null;

function isCodePath(rel: string) {
  return /\.(tsx?|jsx?|mjs|cjs|json|py|md)$/i.test(rel);
}

async function syncMonacoTypecheck(rel: string, text: string) {
  const monaco = monacoRef;
  if (!monaco || !isCodePath(rel)) return;
  ensureModel(monaco, rel, text);
  await warmMonacoImports(monaco, rel, text, async (p) => (await api().read(p)).content ?? "");
}

export default function Ide() {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [gitFiles, setGitFiles] = useState<Record<string, GitStatus>>({});
  const [openTabs, setOpenTabs] = useState<string[]>(["README.md"]);
  const [path, setPath] = useState("README.md");
  const [content, setContent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>(() => [newSession({ id: "welcome", title: "Chat" })]);
  const [activeChatId, setActiveChatId] = useState("welcome");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const streamMsgIdRef = useRef<string | null>(null);
  const session = sessions.find((s) => s.id === activeChatId) ?? sessions[0];
  const log = session?.log ?? [];
  const plan = session?.plan ?? [];
  const [graph, setGraph] = useState<{
    nodes: unknown[];
    edges?: unknown[];
    walkIds: string[];
    anchorId?: string;
  } | null>(null);
  const [diffs, setDiffs] = useState<{ path: string; before: string; after: string }[]>([]);
  const [diffIdx, setDiffIdx] = useState(0);
  const [mode, setMode] = useState<"edit" | "preview" | "diff">("preview");
  const [graphFull, setGraphFull] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const lang = monacoLanguage(mode === "diff" && diffs[diffIdx] ? diffs[diffIdx].path : path);

  async function refreshGitStatus() {
    if (!api().gitStatus) return;
    try {
      const data = await api().gitStatus();
      const next: Record<string, GitStatus> = {};
      for (const [rel, status] of Object.entries(data.files || {})) {
        next[rel] = status as GitStatus;
      }
      setGitFiles(next);
    } catch {
      setGitFiles({});
    }
  }

  async function loadTree() {
    const data = await api().tree();
    setTree((data.tree || []) as FileEntry[]);
    await refreshGitStatus();
  }

  async function openFile(rel: string) {
    const data = await api().read(rel);
    setPath(rel);
    setContent(data.content ?? "");
    setMode(isMarkdown(rel) ? "preview" : "edit");
    setOpenTabs((tabs) => (tabs.includes(rel) ? tabs : [...tabs, rel]));
    await syncMonacoTypecheck(rel, data.content ?? "");
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
    await refreshGitStatus();
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

  async function showGraph() {
    try {
      await loadGraph("");
    } catch {
      /* graph worker may be unavailable */
    }
  }

  function openGraphFull() {
    setGraphFull(true);
    void showGraph();
  }

  useEffect(() => {
    if (!graphFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGraphFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graphFull]);

  function patchSession(id: string, fn: (s: ChatSession) => ChatSession) {
    setSessions((all) => all.map((s) => (s.id === id ? fn(s) : s)));
  }

  function startNewChat() {
    api().abortAgent?.();
    const next = newSession();
    setSessions((all) => [...all, next]);
    setActiveChatId(next.id);
    setPrompt("");
    chatPanelRef.current?.expand();
    setChatCollapsed(false);
  }

  function closeChat(id: string, e?: MouseEvent) {
    e?.stopPropagation();
    setSessions((all) => {
      const rest = all.filter((s) => s.id !== id);
      const next = rest.length ? rest : [newSession({ title: "Chat" })];
      if (id === activeChatIdRef.current) setActiveChatId(next[next.length - 1].id);
      return next;
    });
  }

  function toggleChatPanel() {
    const panel = chatPanelRef.current;
    if (!panel) return;
    if (chatCollapsed || panel.isCollapsed?.()) {
      panel.expand();
      setChatCollapsed(false);
    } else {
      panel.collapse();
      setChatCollapsed(true);
    }
  }

  function runAgent() {
    const text = prompt.trim();
    if (!text) return;
    const chatId = activeChatIdRef.current;
    const assistantId = crypto.randomUUID();
    streamMsgIdRef.current = assistantId;
    const prior = sessions.find((s) => s.id === chatId)?.log ?? [];
    const history = [...prior, { role: "user" as const, text }]
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.text.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, text: m.text }));
    patchSession(chatId, (s) => ({
      ...s,
      title: s.title === "New chat" || s.title === "Chat" ? text.slice(0, 36) : s.title,
      log: [
        ...s.log.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        { id: crypto.randomUUID(), role: "user", text },
        { id: assistantId, role: "assistant", text: "", streaming: true },
      ],
    }));
    setPrompt("");
    loadGraph(text).catch(() => undefined);
    void api()
      .startAgent(text, { history })
      .catch((err) => {
        patchSession(chatId, (s) => ({
          ...s,
          log: [
            ...s.log,
            { id: crypto.randomUUID(), role: "error", text: `Agent failed to start: ${err}` },
          ],
        }));
      });
  }

  async function reject() {
    await api().rejectDiffs();
    await loadDiffs();
    await refreshGitStatus();
  }

  useEffect(() => {
    if (!window.harness) return;
    loadTree();
    (async () => {
      try {
        const data = await api().read("README.md");
        setPath("README.md");
        setContent(data.content ?? "");
        setMode("preview");
        setOpenTabs((tabs) => (tabs.includes("README.md") ? tabs : ["README.md", ...tabs]));
      } catch {
        openFile("README.md").catch(() => undefined);
      }
    })();
    const off = api().onAgentEvent((ev) => {
      const chatId = activeChatIdRef.current;
      const streamId = streamMsgIdRef.current;
      if (ev.type === "token") {
        const piece = String(ev.text || "");
        if (!piece || !streamId) return;
        patchSession(chatId, (s) => ({
          ...s,
          log: s.log.map((m) => (m.id === streamId ? { ...m, text: m.text + piece } : m)),
        }));
      }
      if (ev.type === "tool") {
        patchSession(chatId, (s) => ({
          ...s,
          log: [...s.log, { id: crypto.randomUUID(), role: "tool", text: `tool ${ev.name}` }],
        }));
      }
      if (ev.type === "error") {
        patchSession(chatId, (s) => ({
          ...s,
          log: [...s.log, { id: crypto.randomUUID(), role: "error", text: String(ev.message) }],
        }));
      }
      if (ev.type === "status" && streamId) {
        patchSession(chatId, (s) => ({
          ...s,
          log: s.log.map((m) =>
            m.id === streamId && !m.text ? { ...m, text: "", streaming: true } : m,
          ),
        }));
      }
      if (ev.type === "plan") patchSession(chatId, (s) => ({ ...s, plan: (ev.steps as PlanStep[]) || [] }));
      if (ev.type === "graph") {
        setGraph({
          nodes: (ev.nodes as unknown[]) || [],
          edges: (ev.edges as unknown[]) || [],
          walkIds: (ev.walkIds as string[]) || [],
          anchorId: ev.anchorId as string | undefined,
        });
      }
      if (ev.type === "fs") void loadTree();
      if (ev.type === "done") {
        patchSession(chatId, (s) => ({
          ...s,
          log: s.log.map((m) => (m.id === streamId || m.streaming ? { ...m, streaming: false } : m)),
        }));
        loadDiffs();
        void loadTree();
      }
    });
    return () => off();
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    if (mode !== "edit") return;
    void syncMonacoTypecheck(path, content);
  }, [path, mode]);

  const currentDiff = diffs[diffIdx];
  const fileName = path.split("/").pop() || path;
  const gitLabels = useMemo(() => buildGitLabels(tree, gitFiles), [tree, gitFiles]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="surface-app relative flex h-screen min-h-0 min-w-0 flex-col overflow-hidden">
        <TitleBar onOpenGraph={openGraphFull} />
        <ResizablePanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
          <ResizablePanel defaultSize={18} minSize={10} maxSize={32} className="surface-sidebar min-w-0 overflow-hidden">
            <div className="flex h-8 items-center justify-between gap-2 px-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Explorer</span>
              <ToolBtn label="Open folder" onClick={() => api().pickWorkspace().then(loadTree)}>
                <FolderOpen className="size-3.5" />
              </ToolBtn>
            </div>
            <ScrollArea className="h-[calc(100%-2rem)]">
              <FileTree entries={tree} onOpen={openFile} activePath={path} gitLabels={gitLabels} />
            </ScrollArea>
          </ResizablePanel>
          <ResizableHandle className="w-px" />
          <ResizablePanel defaultSize={52} minSize={28} className="surface-editor min-w-0 overflow-hidden">
            <ResizablePanelGroup direction="vertical" className="min-h-0 min-w-0">
              <ResizablePanel defaultSize={78} minSize={30} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--editor)]">
                <div className="surface-chrome flex h-9 min-w-0 shrink-0 items-stretch overflow-hidden">
                  <ScrollArea className="tab-strip h-9 min-w-0 flex-1">
                    <div className="flex h-9 w-max min-w-full items-stretch">
                    {openTabs.map((t) => (
                    <button
                      key={t}
                      onClick={() => openFile(t)}
                      className={cn(
                        "group flex h-9 max-w-[180px] shrink-0 items-center gap-1.5 border-r border-border-subtle px-3 text-[12.5px]",
                        t === path && mode !== "diff"
                          ? "bg-[var(--editor)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] border-b-2 border-b-primary"
                          : "text-muted-foreground hover:text-foreground",
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
                    </div>
                  </ScrollArea>
                  <div className="ml-auto flex shrink-0 items-center gap-0.5 px-2">
                    <ToolBtn label="Save" onClick={save}>
                      <Save className="size-3.5" />
                    </ToolBtn>
                    <ToolBtn label="Review diffs" onClick={loadDiffs}>
                      <GitCompare className="size-3.5" />
                    </ToolBtn>
                    <ToolBtn label="Reject writes" onClick={reject}>
                      <RotateCcw className="size-3.5" />
                    </ToolBtn>
                    {isMarkdown(path) && mode !== "diff" ? (
                      <div className="surface-inset mr-1 flex rounded-md p-0.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className={cn(
                            "h-6 gap-1 px-2 text-[11px]",
                            mode === "preview"
                              ? "bg-[#3a3a3a] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setMode("preview")}
                        >
                          <BookOpen className="size-3" />
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={cn(
                            "h-6 gap-1 px-2 text-[11px]",
                            mode === "edit"
                              ? "bg-[#3a3a3a] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setMode("edit")}
                        >
                          <Code2 className="size-3" />
                          Source
                        </Button>
                      </div>
                    ) : null}
                    <Button
                      size="sm"
                      variant={mode === "diff" ? "secondary" : "ghost"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setMode(mode === "diff" ? (isMarkdown(path) ? "preview" : "edit") : "diff")}
                    >
                      {mode === "diff" ? "Edit" : "Review"}
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  {mode === "preview" ? (
                    <ScrollArea className="h-full min-w-0">
                      <article className="mx-auto max-w-3xl min-w-0 px-6 py-8 sm:px-8">
                        <p className="mb-6 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview · {fileName}</p>
                        <ChatMarkdown text={content} className="space-y-4 text-[14px] leading-7" />
                      </article>
                    </ScrollArea>
                  ) : mode === "edit" ? (
                    <Editor
                      height="100%"
                      theme="harness-dark"
                      path={path}
                      language={lang}
                      value={content}
                      beforeMount={monacoBeforeMount}
                      onMount={(editor) => {
                        void syncMonacoTypecheck(path, editor.getValue());
                      }}
                      onChange={(v) => setContent(v || "")}
                      options={editorOptions}
                    />
                  ) : currentDiff ? (
                    <div className="flex h-full flex-col">
                      <div className="flex gap-1 overflow-x-auto border-b border-border-subtle px-2 py-1">
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
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      No uncommitted diffs
                    </div>
                  )}
                </div>
              </ResizablePanel>
              <ResizableHandle className="h-px" />
              <ResizablePanel defaultSize={22} minSize={10} className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--code)]">
                <div className="shrink-0 border-b border-border-subtle px-3 py-1 text-[11px] font-medium text-muted-foreground">Terminal</div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <TerminalPane />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle className="w-px" />
          <ResizablePanel
            ref={chatPanelRef}
            defaultSize={30}
            minSize={18}
            maxSize={48}
            collapsible
            collapsedSize={3.2}
            onCollapse={() => setChatCollapsed(true)}
            onExpand={() => setChatCollapsed(false)}
            className="surface-chat flex min-w-0 flex-col overflow-hidden"
          >
            {chatCollapsed ? (
              <div className="flex h-full flex-col items-center gap-1 py-2">
                <ToolBtn label="Open chat" onClick={toggleChatPanel}>
                  <PanelRightOpen className="size-3.5" />
                </ToolBtn>
                <ToolBtn label="New chat" onClick={startNewChat}>
                  <Plus className="size-3.5" />
                </ToolBtn>
              </div>
            ) : (
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <div className="flex h-9 min-w-0 items-stretch border-b border-border-subtle">
                <ScrollArea className="h-9 min-w-0 flex-1">
                  <div className="flex h-9 w-max min-w-full items-stretch">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setActiveChatId(s.id)}
                        className={cn(
                          "group flex h-9 max-w-[160px] shrink-0 items-center gap-1.5 border-r border-border-subtle px-3 text-[12px]",
                          s.id === activeChatId
                            ? "bg-[var(--chat)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] border-b-2 border-b-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span className="truncate">{s.title}</span>
                        <X
                          className="size-3 shrink-0 opacity-0 group-hover:opacity-70"
                          onClick={(e) => closeChat(s.id, e)}
                        />
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                <div className="ml-auto flex shrink-0 items-center gap-0.5 px-1">
                  <ToolBtn label="New chat" onClick={startNewChat}>
                    <Plus className="size-3.5" />
                  </ToolBtn>
                  <ToolBtn label="Collapse chat" onClick={toggleChatPanel}>
                    <PanelRightClose className="size-3.5" />
                  </ToolBtn>
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <ScrollArea className="min-h-0 min-w-0 flex-1">
                  <div className="min-w-0 max-w-full space-y-3 overflow-hidden px-3 py-3">
                    {fileName ? (
                      <p className="text-[11px] text-muted-foreground">
                        Context · <span className="font-mono text-info">{fileName}</span>
                      </p>
                    ) : null}
                    {plan.length > 0 ? (
                      <ul className="surface-inset space-y-1.5 rounded-md border border-border-subtle p-2">
                        {plan.map((s) => (
                          <li key={s.id} className="flex items-start gap-2 text-xs">
                            <Badge variant={planVariant(s.status)}>{s.status}</Badge>
                            <span className="leading-5 text-foreground">{s.text}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {log.length === 0 ? (
                      <p className="text-sm leading-6 text-muted-foreground">
                        Ask the coding agent about this workspace. Open Graph from the title bar for the code graph.
                      </p>
                    ) : (
                      log.map((m) => (
                        <div
                          key={m.id}
                          className={cn(
                            "min-w-0 max-w-full overflow-hidden px-1 py-1 text-[13px] leading-6",
                            m.role === "user" &&
                              "ml-4 rounded-2xl bg-secondary px-3 py-2 text-secondary-foreground shadow-[var(--elev-raised)] [overflow-wrap:anywhere]",
                            m.role === "assistant" && "mr-0",
                            m.role === "tool" && "break-all font-mono text-[11px] text-info",
                            m.role === "error" && "text-destructive",
                          )}
                        >
                          {m.role === "assistant" ? (
                            m.text ? (
                              <ChatMarkdown text={m.text} />
                            ) : m.streaming ? (
                              <span className="text-muted-foreground">Working…</span>
                            ) : null
                          ) : (
                            m.text
                          )}
                        </div>
                      ))
                    )}
                    <div ref={chatEnd} />
                  </div>
                </ScrollArea>
                <div className="min-w-0 shrink-0 border-t border-border-subtle p-3">
                  <div className="surface-inset relative min-w-0 rounded-xl border border-border-subtle focus-within:border-ring focus-within:shadow-[0_0_0_1px_var(--ring)]">
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
                      className="min-h-[72px] w-full max-w-full resize-none border-0 bg-transparent px-9 pr-16 text-[13px] shadow-none focus-visible:ring-0"
                    />
                    <div className="absolute bottom-2 left-2">
                      <ToolBtn label="New chat" onClick={startNewChat}>
                        <Plus className="size-3.5" />
                      </ToolBtn>
                    </div>
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
              </div>
            </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
        {graphFull ? (
          <div className="absolute inset-0 z-50 flex flex-col bg-background">
            <div className="titlebar-no-drag flex h-9 shrink-0 items-center justify-between border-b border-border-subtle px-3">
              <span className="text-[12px] font-semibold tracking-tight">Code graph</span>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setGraphFull(false)}>
                Close
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <GraphPane payload={graph} />
            </div>
          </div>
        ) : null}
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
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
