import { contextBridge, ipcRenderer } from 'electron';
import type { KilterIpc } from './models/types';

/**
 * Typed bridge exposed to the renderer as `window.kilter`.
 *
 * Renderer code never imports `electron` or anything from this package
 * directly — it goes through this bridge. Channels are a fixed allowlist.
 */
const api: KilterIpc = {
  catalog: {
    init: () => ipcRenderer.invoke('catalog.init'),
    status: () => ipcRenderer.invoke('catalog.status'),
    openBundle: (bundleDir) => ipcRenderer.invoke('catalog.openBundle', bundleDir),
    pickAndOpenBundle: () => ipcRenderer.invoke('catalog.pickAndOpenBundle'),
    listBoardConfigs: () => ipcRenderer.invoke('catalog.listBoardConfigs'),
    listClimbsForCombo: (comboId, query) => ipcRenderer.invoke('catalog.listClimbsForCombo', comboId, query),
    listGradesForCombo: (comboId) => ipcRenderer.invoke('catalog.listGradesForCombo', comboId),
    getClimbDetail: (uuid) => ipcRenderer.invoke('catalog.getClimbDetail', uuid),
    getBoardImage: (comboId) => ipcRenderer.invoke('catalog.getBoardImage', comboId)
  },
  adb: {
    detect: () => ipcRenderer.invoke('adb.detect'),
    setBinaryPath: (path) => ipcRenderer.invoke('adb.setBinaryPath', path),
    listDevices: () => ipcRenderer.invoke('adb.listDevices'),
    startServer: () => ipcRenderer.invoke('adb.startServer')
  },
  session: {
    start: (serial) => ipcRenderer.invoke('session.start', serial),
    runStrategies: (id) => ipcRenderer.invoke('session.runStrategies', id),
    get: (id) => ipcRenderer.invoke('session.get', id),
    list: () => ipcRenderer.invoke('session.list'),
    export: (id, dir) => ipcRenderer.invoke('session.export', id, dir)
  },
  diagnostics: {
    tail: (limit) => ipcRenderer.invoke('diagnostics.tail', limit)
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke('dialog.pickDirectory'),
    pickFile: () => ipcRenderer.invoke('dialog.pickFile')
  },
  events: {
    onSessionProgress: (cb) => {
      const wrapped = (_: unknown, payload: { sessionId: string; phase: string; message: string }) => cb(payload);
      ipcRenderer.on('session.progress', wrapped);
      return () => ipcRenderer.removeListener('session.progress', wrapped);
    },
    onLog: (cb) => {
      const wrapped = (_: unknown, entry: Parameters<typeof cb>[0]) => cb(entry);
      ipcRenderer.on('log.entry', wrapped);
      return () => ipcRenderer.removeListener('log.entry', wrapped);
    }
  }
};

contextBridge.exposeInMainWorld('kilter', api);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Window {
    kilter: KilterIpc;
  }
}
