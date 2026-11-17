'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('yfExe', {
  onPayload: fn => ipcRenderer.on('payload', (_e, d) => fn(d)),
  onState: fn => ipcRenderer.on('state', (_e, s) => fn(s)),
  endEdit: () => ipcRenderer.send('end-edit'),
  onFx: fn => ipcRenderer.on('fx', (_e, d) => fn(d)),
  onClipUrl: fn => ipcRenderer.on('clip-url', (_e, d) => fn(d)),
  fxNeed: ids => ipcRenderer.send('fx-need', ids),
  needClip: d => ipcRenderer.send('need-clip', d),
});
