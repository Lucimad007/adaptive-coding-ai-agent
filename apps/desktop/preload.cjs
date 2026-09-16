const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("harness", {
  tree: () => ipcRenderer.invoke("files:tree"),
  read: (rel) => ipcRenderer.invoke("files:read", rel),
  write: (rel, content) => ipcRenderer.invoke("files:write", rel, content),
  graph: (query) =>
    query
      ? ipcRenderer.invoke("graph:retrieve", query)
      : ipcRenderer.invoke("graph:get"),
  diffs: () => ipcRenderer.invoke("diffs:list"),
  rejectDiffs: () => ipcRenderer.invoke("diffs:reject"),
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  startAgent: (prompt) => ipcRenderer.invoke("agent:start", prompt),
  abortAgent: () => ipcRenderer.invoke("agent:abort"),
  onAgentEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  },
  termOpen: () => ipcRenderer.send("term:open"),
  termData: (chunk) => ipcRenderer.send("term:data", chunk),
  termClose: () => ipcRenderer.send("term:close"),
  onTermData: (cb) => {
    const handler = (_e, d) => cb(d);
    ipcRenderer.on("term:data", handler);
    return () => ipcRenderer.removeListener("term:data", handler);
  },
});
