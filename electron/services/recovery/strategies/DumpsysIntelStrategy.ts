import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import type { RecoveryStrategy } from '../StrategyEngine';

/**
 * Indirect-evidence strategy. Even when nothing useful can be pulled,
 * `dumpsys` and `pm` provide forensic context: when the app was first
 * installed, last updated, last used, how big its data directory is.
 *
 * We persist the raw dumpsys output as a text artifact so the user has a
 * verifiable record.
 */
export const DumpsysIntelStrategy: RecoveryStrategy = {
  id: 'dumpsys.intel',
  description: 'Capture indirect evidence — install/update times, app data size, last use',
  requires: ['adb.connected', 'dumpsys.package'],
  async run(ctx) {
    if (ctx.detectedPackages.length === 0) {
      return {
        attempted: [],
        artifactIds: [],
        confidence: 'low',
        notes: ['no detected packages — nothing to dumpsys'],
        errors: []
      };
    }
    const serial = ctx.session.device.serial;
    const attempted: string[] = [];
    const artifactIds: string[] = [];
    const notes: string[] = [];
    const errors: string[] = [];

    for (const pkg of ctx.detectedPackages) {
      attempted.push(`dumpsys package ${pkg.packageId}`);
      const dump = await ctx.adb.run(['shell', 'dumpsys', 'package', pkg.packageId], { serial });
      if (dump.code === 0 && dump.stdout) {
        const local = join(ctx.session.workspaceDir, 'raw', `dumpsys__${pkg.packageId}.txt`);
        await fs.writeFile(local, dump.stdout, 'utf8');
        const rec = await ctx.registerArtifact({
          sourceDevicePath: null,
          hostPath: local,
          fileName: `dumpsys__${pkg.packageId}.txt`,
          size: dump.stdout.length,
          inferredType: 'text/plain',
          magic: null,
          strategyId: 'dumpsys.intel',
          acquisitionMethod: 'adb shell dumpsys package',
          capturedAt: new Date().toISOString(),
          selectionReason: `dumpsys output for ${pkg.packageId}`
        });
        artifactIds.push(rec.id);
      } else if (dump.stderr) {
        errors.push(`dumpsys ${pkg.packageId}: ${dump.stderr.trim()}`);
      }

      // Try to capture an app data size estimate.
      attempted.push(`du -sh /data/data/${pkg.packageId} (will likely be permission-denied without root)`);
      const du = await ctx.adb.run(['shell', `du -sh /data/data/${pkg.packageId} 2>/dev/null || echo permission-denied`], { serial });
      if (du.code === 0) notes.push(`du(${pkg.packageId}) = ${du.stdout.trim()}`);
    }

    return {
      attempted,
      artifactIds,
      confidence: 'medium',
      notes,
      errors
    };
  }
};
