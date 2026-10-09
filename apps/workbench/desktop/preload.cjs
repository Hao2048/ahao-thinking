const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aipmDesktop', {
  platform: 'darwin',
  onAction(callback) {
    const handler = (_event, action) => { if (['settings', 'new-project', 'all-documents'].includes(action)) callback(action); };
    ipcRenderer.on('workbench-action', handler);
    return () => ipcRenderer.removeListener('workbench-action', handler);
  },
});
window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('desktop');
  const bar = document.createElement('div');
  bar.className = 'desktop-titlebar';
  bar.textContent = '好浩的产品工作台';
  document.body.prepend(bar);
});
