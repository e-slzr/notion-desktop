const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  reload: () => ipcRenderer.send('window-reload'),
  goBack: () => ipcRenderer.send('window-go-back'),
  goForward: () => ipcRenderer.send('window-go-forward'),

  onMaximizeChange: (callback) => {
    ipcRenderer.on('window-maximize-changed', (_event, isMaximized) => callback(isMaximized));
  },

  onNavigationState: (callback) => {
    ipcRenderer.on('navigation-state', (_event, state) => callback(state));
  },

  onUnreadUpdate: (callback) => {
    ipcRenderer.on('update-unread', (_event, count) => callback(count));
  },

  onTitleUpdate: (callback) => {
    ipcRenderer.on('update-title', (_event, title) => callback(title));
  },

  sendResize: (w, h) => ipcRenderer.send('window-resized', { width: w, height: h })
});
