// Sandboxed bridge: the panel gets exactly these five calls and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  status: () => ipcRenderer.invoke('host:status'),
  restart: (settings) => ipcRenderer.invoke('host:restart', settings),
  openGame: () => ipcRenderer.invoke('host:open-game'),
  copy: (text) => ipcRenderer.invoke('host:copy', text),
  openExternal: (url) => ipcRenderer.invoke('host:open-external', url),
  onUpdate: (fn) => {
    ipcRenderer.on('host:update', (_event, data) => fn(data));
  },
});
