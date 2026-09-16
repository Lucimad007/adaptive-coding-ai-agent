const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harness", {
  platform: process.platform,
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onWindowMaximized: (cb) => {
    const handler = (_e, maximized) => cb(maximized);
    ipcRenderer.on("window:maximized", handler);
    return () => ipcRenderer.removeListener("window:maximized", handler);
  },
  tree: () => ipcRenderer.invoke("files:tree"),
  gitStatus: () => ipcRenderer.invoke("git:status"),
  read: (rel) => ipcRenderer.invoke("files:read", rel),
  write: (rel, content) => ipcRenderer.invoke("files:write", rel, content),
  graph: (query) =>
    query
      ? ipcRenderer.invoke("graph:retrieve", query)
      : ipcRenderer.invoke("graph:get"),
  diffs: () => ipcRenderer.invoke("diffs:list"),
  rejectDiffs: (rel) => ipcRenderer.invoke("diffs:reject", rel),
  skillTrace: (rel, task) => ipcRenderer.invoke("skills:trace", rel, task),
  skillReview: (opts) => ipcRenderer.invoke("skills:review", opts),
  skillsPending: () => ipcRenderer.invoke("skills:pending"),
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  startAgent: (prompt, opts) => ipcRenderer.invoke("agent:start", prompt, opts || {}),
  abortAgent: () => ipcRenderer.invoke("agent:abort"),
  onAgentEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  },
  termOpen: (size) => ipcRenderer.invoke("term:open", size),
  termResize: (size) => ipcRenderer.send("term:resize", size),
  termData: (chunk) => ipcRenderer.send("term:data", chunk),
  termClose: () => ipcRenderer.send("term:close"),
  onTermData: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on("term:data", handler);
    return () => ipcRenderer.removeListener("term:data", handler);
  },
});
