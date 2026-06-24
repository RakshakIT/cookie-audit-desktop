const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cookieScanner', {
  startScan: options => ipcRenderer.invoke('scan:start', options),

  saveFile: payload => ipcRenderer.invoke('file:save', payload),

  savePdf: payload => ipcRenderer.invoke('pdf:save', payload),

  onProgress: callback => {
    ipcRenderer.removeAllListeners('scan:progress');
    ipcRenderer.on('scan:progress', (_event, data) => callback(data));
  }
});
