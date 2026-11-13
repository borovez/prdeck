// The lock screen's only bridge to the app: ask the main process to unlock (Touch ID / password)
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('prdeckLock', { unlock: () => ipcRenderer.invoke('prdeck:unlock') })
