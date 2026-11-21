import { contextBridge, ipcRenderer } from 'electron'
import type { CodeBridge } from './bridge'

const bridge: CodeBridge = {
  getConfig: () => ipcRenderer.invoke('code:config'),
  setToken: (token) => ipcRenderer.send('code:set-token', token),
  resizeMini: (width, height) => ipcRenderer.send('mini:resize', width, height),
  moveMini: (dx, dy) => ipcRenderer.send('mini:move', dx, dy),
  openMain: () => ipcRenderer.send('win:open-main'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  pont: {
    outil: (envoi, outil, input) => ipcRenderer.invoke('pont:outil', envoi, outil, input),
    executer: (envoi, cle) => ipcRenderer.invoke('pont:executer', envoi, cle)
  },
  toMini: () => ipcRenderer.send('win:to-mini'),
  onToggleVoice: (fn) => {
    const listener = () => fn()
    ipcRenderer.on('code:toggle-voice', listener)
    return () => ipcRenderer.removeListener('code:toggle-voice', listener)
  },
  onPresence: (fn) => {
    const listener = () => fn()
    ipcRenderer.on('code:presence', listener)
    return () => ipcRenderer.removeListener('code:presence', listener)
  },
  onSleep: (fn) => {
    const listener = () => fn()
    ipcRenderer.on('code:sleep', listener)
    return () => ipcRenderer.removeListener('code:sleep', listener)
  }
}

contextBridge.exposeInMainWorld('codeBridge', bridge)
