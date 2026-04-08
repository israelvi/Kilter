import { ipcMain, dialog } from 'electron';
import type { AdbService } from './services/adb/AdbService';
import type { RecoverySessionStore } from './services/recovery/RecoverySessionStore';
import type { StrategyEngine } from './services/recovery/StrategyEngine';
import type { ExportService } from './services/export/ExportService';
import type { KilterCatalogService } from './services/catalog/KilterCatalogService';
import type { Logger } from './services/logging/Logger';
import type { Capability, RecoverySession } from './models/types';
import type { ClimbListQuery } from './models/catalogTypes';

interface Deps {
  adb: AdbService;
  store: RecoverySessionStore;
  engine: StrategyEngine;
  exporter: ExportService;
  logger: Logger;
  catalog: KilterCatalogService;
}

/**
 * Single registration point for IPC. Channel names are the only contract
 * with the renderer; everything else is plain TypeScript.
 */
export function registerIpc(deps: Deps): void {
  const { adb, store, engine, exporter, logger, catalog } = deps;

  ipcMain.handle('adb.detect', async () => {
    return adb.detect(true);
  });

  ipcMain.handle('adb.setBinaryPath', async (_e, path: string) => {
    return adb.setBinaryPath(path);
  });

  ipcMain.handle('adb.listDevices', async () => {
    await adb.detect();
    return adb.listDevices();
  });

  ipcMain.handle('adb.startServer', async () => {
    return adb.startServer();
  });

  ipcMain.handle('session.start', async (_e, serial: string): Promise<RecoverySession> => {
    if (typeof serial !== 'string' || serial.length === 0) {
      throw new Error('serial is required');
    }
    logger.info('ipc', 'session.start', { serial });

    const profile = await adb.getDeviceProfile(serial);
    const capabilities = await detectCapabilities(adb, serial, profile.sdkInt);

    const session = await store.create({
      device: profile,
      capabilities,
      detectedPackages: []
    });
    return session;
  });

  ipcMain.handle('session.runStrategies', async (_e, sessionId: string) => {
    return engine.run(sessionId);
  });

  ipcMain.handle('session.get', async (_e, sessionId: string) => {
    return store.get(sessionId);
  });

  ipcMain.handle('session.list', async () => {
    return store.list();
  });

  ipcMain.handle('session.export', async (_e, sessionId: string, targetDir: string) => {
    const s = store.get(sessionId);
    if (!s) throw new Error(`session ${sessionId} not found`);
    if (typeof targetDir !== 'string' || targetDir.length === 0) {
      throw new Error('export target directory is required');
    }
    return exporter.export(s, targetDir);
  });

  ipcMain.handle('diagnostics.tail', async (_e, limit?: number) => {
    return logger.tail(limit ?? 500);
  });

  ipcMain.handle('dialog.pickDirectory', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog.pickFile', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'] });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });

  // ── Kilter Catalog ──────────────────────────────────────────────────
  ipcMain.handle('catalog.init',   async () => catalog.init());
  ipcMain.handle('catalog.status', async () => catalog.getStatus());

  ipcMain.handle('catalog.openBundle', async (_e, bundleDir: string) => {
    if (typeof bundleDir !== 'string' || bundleDir.length === 0) {
      throw new Error('bundleDir is required');
    }
    return catalog.openFromBundle(bundleDir);
  });

  ipcMain.handle('catalog.pickAndOpenBundle', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose a recovery bundle',
      properties: ['openDirectory']
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return catalog.openFromBundle(r.filePaths[0]);
  });

  ipcMain.handle('catalog.listBoardConfigs', async () => {
    return catalog.listBoardConfigs();
  });

  ipcMain.handle('catalog.listClimbsForCombo', async (_e, comboId: number, query: ClimbListQuery) => {
    return catalog.listClimbsForCombo(comboId, query ?? {});
  });

  ipcMain.handle('catalog.listGradesForCombo', async (_e, comboId: number) => {
    return catalog.listGradesForCombo(comboId);
  });

  ipcMain.handle('catalog.getClimbDetail', async (_e, uuid: string) => {
    return catalog.getClimbDetail(uuid);
  });

  ipcMain.handle('catalog.getBoardImage', async (_e, comboId: number) => {
    return catalog.getBoardImageBase64(comboId);
  });
}

/**
 * Probes the device to figure out which capabilities are actually
 * available. Each capability check is independent and best-effort.
 */
async function detectCapabilities(
  adb: AdbService,
  serial: string,
  sdkInt: number | null
): Promise<Record<Capability, boolean>> {
  const caps: Record<Capability, boolean> = {
    'adb.connected': true,
    'adb.shell': false,
    'adb.pull': true,
    'pm.list': false,
    'pm.path': false,
    'dumpsys.package': false,
    'backup.api': sdkInt != null && sdkInt >= 23 && sdkInt <= 30,
    'sdcard.read': false,
    'appdata.legacy.read': sdkInt != null && sdkInt < 30,
    'mediastore.query': false,
    root: false
  };

  const echo = await adb.run(['shell', 'echo', 'ok'], { serial });
  caps['adb.shell'] = echo.code === 0 && echo.stdout.trim() === 'ok';

  const pm = await adb.run(['shell', 'pm', 'list', 'packages', 'android'], { serial });
  caps['pm.list'] = pm.code === 0 && pm.stdout.includes('package:android');

  const pmPath = await adb.run(['shell', 'pm', 'path', 'android'], { serial });
  caps['pm.path'] = pmPath.code === 0 && pmPath.stdout.includes('package:');

  const dump = await adb.run(['shell', 'dumpsys', 'package', 'android'], { serial });
  caps['dumpsys.package'] = dump.code === 0 && dump.stdout.includes('Package [android]');

  const ls = await adb.run(['shell', 'ls', '/sdcard'], { serial });
  caps['sdcard.read'] = ls.code === 0 && !ls.stdout.toLowerCase().includes('permission denied');

  const ms = await adb.run(['shell', 'content', 'query', '--uri', 'content://media/external/file', '--projection', '_id', '--limit', '1'], { serial });
  caps['mediastore.query'] = ms.code === 0;

  // Root detection: try `id` under su. We do not invoke su; we only check for its presence.
  const which = await adb.run(['shell', 'which', 'su'], { serial });
  caps.root = which.code === 0 && which.stdout.trim().length > 0;

  return caps;
}
