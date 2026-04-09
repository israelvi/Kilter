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

  ipcMain.handle('catalog.exportAllForBoardPulse', async (e) => {
    const configs = catalog.listBoardConfigs();
    if (configs.length === 0) throw new Error('No board configurations found');

    const r = await dialog.showSaveDialog({
      title: 'Export all boards for BoardPulse',
      defaultPath: 'board-catalog.obc.gz',
      filters: [
        { name: 'OpenBoard Catalog (compressed)', extensions: ['obc.gz'] },
        { name: 'OpenBoard Catalog (JSON)', extensions: ['obc.json'] }
      ]
    });
    if (r.canceled || !r.filePath) return null;

    const useGzip = r.filePath.endsWith('.gz');
    const win = require('electron').BrowserWindow.fromWebContents(e.sender);

    const allCatalogs: any[] = [];
    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      win?.webContents.send('export.progress', {
        current: i + 1,
        total: configs.length,
        boardName: `${cfg.productName} ${cfg.sizeName} ${cfg.setName}`,
        percent: Math.round(((i + 1) / configs.length) * 90)
      });
      const json = catalog.exportForBoardPulse(cfg.comboId);
      allCatalogs.push(JSON.parse(json));
    }

    win?.webContents.send('export.progress', {
      current: configs.length,
      total: configs.length,
      boardName: useGzip ? 'Compressing...' : 'Writing file...',
      percent: 95
    });

    const bundle = {
      format: 'openboard-catalog-bundle',
      schemaVersion: 1,
      catalogs: allCatalogs,
      metadata: {
        exportedAt: new Date().toISOString(),
        exportedBy: 'Kilter Recovery Kit',
        boardCount: allCatalogs.length,
        totalClimbs: allCatalogs.reduce((sum: number, c: any) => sum + (c.metadata?.climbCount ?? 0), 0)
      }
    };

    const jsonStr = JSON.stringify(bundle);
    const { promises: fsp } = require('node:fs');

    if (useGzip) {
      const { gzipSync } = require('node:zlib');
      const compressed = gzipSync(Buffer.from(jsonStr, 'utf-8'), { level: 9 });
      await fsp.writeFile(r.filePath, compressed);
    } else {
      await fsp.writeFile(r.filePath, jsonStr, 'utf-8');
    }

    const { statSync } = require('node:fs');
    const fileSize = statSync(r.filePath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
    const rawMB = (Buffer.byteLength(jsonStr, 'utf-8') / 1024 / 1024).toFixed(1);
    const totalClimbs = bundle.metadata.totalClimbs;

    return {
      path: r.filePath,
      count: allCatalogs.length,
      totalClimbs,
      sizeMB,
      rawMB: useGzip ? rawMB : null,
      compressed: useGzip
    };
  });

  ipcMain.handle('catalog.exportForBoardPulse', async (e, comboId: number) => {
    const json = catalog.exportForBoardPulse(comboId);
    const cfg = catalog.listBoardConfigs().find((c) => c.comboId === comboId);
    const baseName = cfg
      ? `${cfg.productName}-${cfg.sizeName}-${cfg.setName}`.toLowerCase().replace(/\s+/g, '-')
      : 'board-catalog';

    const r = await dialog.showSaveDialog({
      title: 'Export catalog for BoardPulse',
      defaultPath: `${baseName}.obc.gz`,
      filters: [
        { name: 'OpenBoard Catalog (compressed)', extensions: ['obc.gz'] },
        { name: 'OpenBoard Catalog (JSON)', extensions: ['obc.json'] }
      ]
    });
    if (r.canceled || !r.filePath) return null;

    const useGzip = r.filePath.endsWith('.gz');
    const { promises: fsp } = require('node:fs');

    if (useGzip) {
      const { gzipSync } = require('node:zlib');
      const compressed = gzipSync(Buffer.from(json, 'utf-8'), { level: 9 });
      await fsp.writeFile(r.filePath, compressed);
    } else {
      await fsp.writeFile(r.filePath, json, 'utf-8');
    }

    const { statSync } = require('node:fs');
    const fileSize = statSync(r.filePath).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
    const rawMB = (Buffer.byteLength(json, 'utf-8') / 1024 / 1024).toFixed(1);
    const parsed = JSON.parse(json);
    const climbCount = parsed.metadata?.climbCount ?? 0;
    const boardName = cfg ? `${cfg.productName} ${cfg.sizeName} ${cfg.setName}` : 'Board';

    return {
      path: r.filePath,
      boardName,
      climbCount,
      sizeMB,
      rawMB: useGzip ? rawMB : null,
      compressed: useGzip
    };
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
