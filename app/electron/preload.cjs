'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deepcwDesktop', {
  isDesktop: true,

  info: () => ipcRenderer.invoke('deepcw:info'),

  /** Save UTF-8 text through the native "Save as" dialog. Resolves to the path or null. */
  saveTextFile: (text, defaultName) =>
    ipcRenderer.invoke('deepcw:save-text', text, defaultName),

  /** Show the native open dialog and return { name, path, data: ArrayBuffer } or null. */
  openAudioFile: () => ipcRenderer.invoke('deepcw:open-audio'),

  /** Write text to the OS clipboard (works even when the window is not focused). */
  copyText: (text) => ipcRenderer.invoke('deepcw:copy-text', text),

  setAlwaysOnTop: (value) => ipcRenderer.invoke('deepcw:always-on-top', value),

  setAwake: (value) => ipcRenderer.invoke('deepcw:set-awake', value),

  openDataFolder: () => ipcRenderer.invoke('deepcw:app-data-folder'),

  setLanguage: (lang) => ipcRenderer.send('deepcw:set-language', lang),

  /** Subscribe to actions coming from the application menu. Returns an unsubscribe fn. */
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('deepcw:menu-action', listener);
    return () => ipcRenderer.removeListener('deepcw:menu-action', listener);
  },

  // ---- Radio control (CAT) -------------------------------------------------
  radio: {
    listPorts: () => ipcRenderer.invoke('deepcw:rig-list'),
    connect: (config) => ipcRenderer.invoke('deepcw:rig-connect', config),
    disconnect: () => ipcRenderer.invoke('deepcw:rig-disconnect'),
    status: () => ipcRenderer.invoke('deepcw:rig-status'),
    setFrequency: (hz) => ipcRenderer.invoke('deepcw:rig-set-frequency', hz),
    setMode: (mode) => ipcRenderer.invoke('deepcw:rig-set-mode', mode),
    setPtt: (on) => ipcRenderer.invoke('deepcw:rig-set-ptt', on),
    autoDetect: () => ipcRenderer.invoke('deepcw:rig-auto-detect'),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('deepcw:rig-status', listener);
      return () => ipcRenderer.removeListener('deepcw:rig-status', listener);
    },
  },

  // ---- WSJT-X / N1MM UDP ---------------------------------------------------
  wsjtx: {
    configure: (config) => ipcRenderer.invoke('deepcw:wsjtx-configure', config),
    send: (type, payload) => ipcRenderer.invoke('deepcw:wsjtx-send', type, payload),
  },

  // ---- Custom background image --------------------------------------------
  background: {
    choose: () => ipcRenderer.invoke('deepcw:background-choose'),
    clear: () => ipcRenderer.invoke('deepcw:background-clear'),
  },
});
