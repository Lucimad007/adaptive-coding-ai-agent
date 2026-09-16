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
  Wrench,
  X,
} from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import ChatMarkdown from "./ChatMarkdown";
import DiffReviewBar from "./DiffReviewBar";
import FileTree, { type FileEntry } from "./FileTree";
import GraphPane from "./GraphPane";
import TerminalPane from "./TerminalPane";
import TitleBar from "./TitleBar";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTypeIcon, monacoLanguage } from "@/lib/files";
import { buildGitLabels, type GitStatus } from "@/lib/gitStatus";
import { configureMonacoTs, ensureModel, warmMonacoImports } from "@/lib/monacoWorkspace";
import { cn } from "@/lib/utils";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";

type PlanStep = { id: string; text: string; status: string };
type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  streaming?: boolean;
  name?: string;
  args?: Record<string, unknown>;
};
type AgentMode = "agent" | "plan" | "chat";
type TodoItem = { id: string; content: string; status: "pending" | "in_progress" | "completed" };
type ChatSession = { id: string; title: string; log: ChatMsg[]; plan: PlanStep[]; todos: TodoItem[] };

function newSession(partial?: Partial<ChatSession>): ChatSession {
  return { id: crypto.randomUUID(), title: "New chat", log: [], plan: [], todos: [], ...partial };
}

function api() {
  return window.harness;
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
      "diffEditor.insertedTextBackground": "#28c84026",
      "diffEditor.removedTextBackground": "#ff5f5726",
      "diffEditor.insertedLineBackground": "#28c84014",
      "diffEditor.removedLineBackground": "#ff5f5714",
      "diffEditor.insertedTextBorder": "#00000000",
      "diffEditor.removedTextBorder": "#00000000",
      "diffEditorGutter.insertedLineBackground": "#28c84010",
      "diffEditorGutter.removedLineBackground": "#ff5f5710",
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

function utf8Safe(s: string) {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

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
  const [agentMode, setAgentMode] = useState<AgentMode>("agent");
  const [agentMenu, setAgentMenu] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;
  const streamMsgIdRef = useRef<string | null>(null);
  const session = sessions.find((s) => s.id === activeChatId) ?? sessions[0];
  const log = session?.log ?? [];
  const todos = session?.todos ?? [];
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
    await loadDiffs(false);
  }

  async function openFile(rel: string) {
    const data = await api().read(rel);
    setPath(rel);
    setContent(data.content ?? "");
    setMode(isMarkdown(rel) ? "preview" : "edit");
    setOpenTabs((tabs) => (tabs.includes(rel) ? tabs : [...tabs, rel]));
    await syncMonacoTypecheck(rel, data.content ?? "");
    const idx = diffs.findIndex((d) => d.path === rel);
    if (idx >= 0) {
      setDiffIdx(idx);
      setMode("diff");
    }
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

  async function loadDiffs(enterReview = true) {
    try {
      const data = await api().diffs();
      const list = data.diffs || [];
      setDiffs(list);
      if (enterReview && list.length) {
        const found = list.findIndex((d) => d.path === path);
        setDiffIdx(found >= 0 ? found : 0);
        setMode("diff");
      } else if (!list.length && mode === "diff") {
        leaveReview();
      }
    } catch {
      setDiffs([]);
    }
  }

  function leaveReview() {
    setMode(isMarkdown(path) ? "preview" : "edit");
  }

  function dropDiff(i: number) {
    const next = diffs.filter((_, idx) => idx !== i);
    setDiffs(next);
    if (!next.length) leaveReview();
    else setDiffIdx(Math.min(i, next.length - 1));
  }

  function acceptDiff() {
    dropDiff(diffIdx);
  }

  async function undoDiff() {
    const d = diffs[diffIdx];
    if (!d) return;
    await api().rejectDiffs(d.path);
    if (path === d.path) {
      try {
        const data = await api().read(d.path);
        setContent(data.content ?? "");
      } catch {
        setContent("");
      }
    }
    dropDiff(diffIdx);
    await loadTree();
  }

  async function reject() {
    await api().rejectDiffs();
    setDiffs([]);
    leaveReview();
    await loadTree();
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
    if (mode !== "diff") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "Y" || e.key === "y")) {
        e.preventDefault();
        acceptDiff();
      } else if (e.ctrlKey && !e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        void undoDiff();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, diffIdx, diffs]);

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
    streamMsgIdRef.current = null;
    setAgentBusy(true);
    const prior = sessions.find((s) => s.id === chatId)?.log ?? [];
    const history = [...prior, { role: "user" as const, text }]
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.text.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, text: utf8Safe(m.text) }));
    patchSession(chatId, (s) => ({
      ...s,
      title: s.title === "New chat" || s.title === "Chat" ? text.slice(0, 36) : s.title,
      log: [...s.log.map((m) => (m.streaming ? { ...m, streaming: false } : m)), { id: crypto.randomUUID(), role: "user", text }],
      todos: [],
    }));
    setPrompt("");
    loadGraph(text).catch(() => undefined);
    void api()
      .startAgent(text, { history, mode: agentModeRef.current })
      .catch((err) => {
        setAgentBusy(false);
        patchSession(chatId, (s) => ({
          ...s,
          log: [
            ...s.log,
            { id: crypto.randomUUID(), role: "error", text: `Agent failed to start: ${err}` },
          ],
        }));
      });
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
      if (ev.type === "token") {
        const piece = utf8Safe(String(ev.text || ""));
        if (!piece) return;
        patchSession(chatId, (s) => {
          const log = [...s.log];
          const last = log[log.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            log[log.length - 1] = { ...last, text: last.text + piece };
          } else {
            const id = crypto.randomUUID();
            streamMsgIdRef.current = id;
            log.push({ id, role: "assistant", text: piece, streaming: true });
          }
          return { ...s, log };
        });
      }
      if (ev.type === "tool") {
        patchSession(chatId, (s) => {
          const log = [...s.log];
          const last = log[log.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            log[log.length - 1] = { ...last, streaming: false };
            streamMsgIdRef.current = null;
          }
          if (ev.name === "update_todos") return { ...s, log };
          const args = (ev as { args?: Record<string, unknown> }).args;
          log.push({
            id: crypto.randomUUID(),
            role: "tool",
            name: ev.name,
            args,
            text: ev.name || "tool",
          });
          return { ...s, log };
        });
      }
      if (ev.type === "error") {
        setAgentBusy(false);
        patchSession(chatId, (s) => ({
          ...s,
          log: [...s.log, { id: crypto.randomUUID(), role: "error", text: String(ev.message) }],
        }));
      }
      if (ev.type === "todos") {
        const rows = Array.isArray(ev.todos) ? ev.todos : [];
        patchSession(chatId, (s) => ({
          ...s,
          todos: rows.map((row, i) => {
            const status =
              row.status === "completed" || row.status === "in_progress" ? row.status : "pending";
            return {
              id: String(row.id || i + 1),
              content: String(row.content || ""),
              status,
            };
          }),
        }));
      }
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
        setAgentBusy(false);
        streamMsgIdRef.current = null;
        patchSession(chatId, (s) => ({
          ...s,
          log: s.log.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        }));
        loadDiffs(true);
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
                    <ToolBtn label="Review diffs" onClick={() => void loadDiffs(true)}>
                      <span className="relative">
                        <GitCompare className="size-3.5" />
                        {diffs.length ? (
                          <span className="absolute -right-1.5 -top-1 min-w-3 rounded-full bg-[#2ea043] px-0.5 text-center text-[8px] font-semibold leading-3 text-white">
                            {diffs.length}
                          </span>
                        ) : null}
                      </span>
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
                      <DiffReviewBar
                        path={currentDiff.path}
                        index={diffIdx}
                        total={diffs.length}
                        onPrev={() => setDiffIdx((i) => Math.max(0, i - 1))}
                        onNext={() => setDiffIdx((i) => Math.min(diffs.length - 1, i + 1))}
                        onUndo={() => void undoDiff()}
                        onKeep={acceptDiff}
                      />
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
                          options={{
                            ...editorOptions,
                            renderSideBySide: true,
                            renderIndicators: false,
                            renderMarginRevertIcon: false,
                            fontSize: 12,
                          }}
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
                <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
                  <span className="flex items-center gap-1.5" aria-hidden>
                    <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="size-2.5 rounded-full bg-[#febc2e]" />
                    <span className="size-2.5 rounded-full bg-[#28c840]" />
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground">Terminal</span>
                </div>
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
                {fileName || todos.length > 0 ? (
                  <div className="shrink-0 space-y-2 border-b border-border-subtle px-3 py-2">
                    {fileName ? (
                      <p className="text-[11px] text-muted-foreground">
                        Context · <span className="font-mono text-info">{fileName}</span>
                      </p>
                    ) : null}
                    {todos.length > 0 ? <TodoList items={todos} /> : null}
                  </div>
                ) : null}
                <ScrollArea className="min-h-0 min-w-0 flex-1">
                  <div className="min-w-0 max-w-full space-y-3 overflow-hidden px-3 py-3">
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
                              <WorkingLabel />
                            ) : null
                          ) : m.role === "tool" ? (
                            <span className="inline-flex max-w-full items-center gap-1.5 font-mono text-[11px] text-info">
                              <Wrench className="size-3 shrink-0" />
                              <span className="truncate">{m.name || m.text}</span>
                              {m.args?.path ? <span className="truncate text-muted-foreground">{String(m.args.path)}</span> : null}
                            </span>
                          ) : (
                            m.text
                          )}
                        </div>
                      ))
                    )}
                    {agentBusy ? (
                      <p className="px-1">
                        <WorkingLabel />
                      </p>
                    ) : null}
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
                      placeholder={
                        agentMode === "plan"
                          ? "Describe the change — I’ll outline steps, no edits…"
                          : agentMode === "chat"
                            ? "Ask about this workspace…"
                            : "Plan, search the graph, or edit files…"
                      }
                      className="min-h-[72px] w-full max-w-full resize-none border-0 bg-transparent px-3 pb-10 pr-3 pt-3 text-[13px] shadow-none focus-visible:ring-0"
                    />
                    <div className="absolute bottom-1.5 left-2 right-2 flex items-center gap-1">
                      <ModeMenu value={agentMode} open={agentMenu} onOpenChange={setAgentMenu} onChange={setAgentMode} />
                      <div className="ml-auto flex gap-1">
                        <ToolBtn label="New chat" onClick={startNewChat}>
                          <Plus className="size-3.5" />
                        </ToolBtn>
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

function WorkingLabel({ text = "Working…" }: { text?: string }) {
  return (
    <AnimatedShinyText className="mx-0 inline max-w-none text-[12px] text-muted-foreground [animation-duration:2.2s]">
      {text}
    </AnimatedShinyText>
  );
}

function TodoList({ items }: { items: TodoItem[] }) {
  const done = items.filter((t) => t.status === "completed").length;
  return (
    <div className="rounded-md border border-border-subtle px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">To-dos</span>
        <span>
          {done}/{items.length}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((t) => (
          <li key={t.id} className="flex items-start gap-2 text-[12px] leading-5">
            <span
              className={cn(
                "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                t.status === "completed" && "border-success bg-success text-[9px] text-success-foreground",
                t.status === "in_progress" && "border-info bg-info/20",
                t.status === "pending" && "border-muted-foreground/40",
              )}
              aria-hidden
            >
              {t.status === "completed" ? "✓" : t.status === "in_progress" ? "•" : ""}
            </span>
            <span className={cn(t.status === "completed" && "text-muted-foreground line-through")}>
              {t.status === "in_progress" ? <WorkingLabel text={t.content} /> : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModeMenu({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: AgentMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (mode: AgentMode) => void;
}) {
  const items: { id: AgentMode; label: string; hint: string }[] = [
    { id: "agent", label: "Agent", hint: "Edit files with tools" },
    { id: "plan", label: "Plan", hint: "Read-only, numbered steps" },
    { id: "chat", label: "Chat", hint: "Ask questions, no writes" },
  ];
  const current = items.find((i) => i.id === value) || items[0];
  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => onOpenChange(!open)}
      >
        {current.label}
        <span className="text-[10px]">▾</span>
      </button>
      {open ? (
        <div className="absolute bottom-8 left-0 z-20 w-56 overflow-hidden rounded-lg border border-border-subtle bg-popover p-1 shadow-[var(--elev-raised)]">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left",
                item.id === value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onClick={() => {
                onChange(item.id);
                onOpenChange(false);
              }}
            >
              <span className="text-[12px] font-medium">{item.label}</span>
              <span className="text-[11px] opacity-70">{item.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
