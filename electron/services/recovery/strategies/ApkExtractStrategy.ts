import { join, basename } from 'node:path';
import type { RecoveryStrategy } from '../StrategyEngine';

/**
 * Pulls the APK file(s) for every detected Kilter package. APKs are
 * always extractable for non-system apps even on locked-down devices, and
 * the APK is the canonical source for confirming `allowBackup`,
 * `debuggable`, signing certs, and on-disk asset layout — all of which
 * inform later strategies.
 */
export const ApkExtractStrategy: RecoveryStrategy = {
  id: 'apk.extract',
  description: 'Pull the APK file(s) for each detected Kilter package',
  requires: ['adb.connected', 'pm.path', 'adb.pull'],
  async run(ctx) {
    if (ctx.detectedPackages.length === 0) {
      return {
        attempted: [],
        artifactIds: [],
        confidence: 'low',
        notes: ['no detected packages to pull APKs for'],
        errors: []
      };
    }
    const attempted: string[] = [];
    const artifactIds: string[] = [];
    const errors: string[] = [];

    for (const pkg of ctx.detectedPackages) {
      for (const remote of pkg.apkPaths) {
        const localName = `${pkg.packageId}__${basename(remote)}`;
        const local = join(ctx.session.workspaceDir, 'raw', localName);
        attempted.push(`adb pull ${remote} → ${local}`);
        const r = await ctx.adb.pull(ctx.session.device.serial, remote, local);
        if (r.code !== 0) {
          errors.push(`failed to pull ${remote}: ${r.stderr.trim() || r.code}`);
          continue;
        }
        const rec = await ctx.registerArtifact({
          sourceDevicePath: remote,
          hostPath: local,
          fileName: localName,
          size: 0, // populated later by parsers
          inferredType: 'application/vnd.android.package-archive',
          magic: 'PK',
          strategyId: 'apk.extract',
          acquisitionMethod: 'adb pull (pm path)',
          capturedAt: new Date().toISOString(),
          selectionReason: `APK for detected package ${pkg.packageId}`
        });
        artifactIds.push(rec.id);
        ctx.emitProgress(`pulled APK ${localName}`);
      }
    }

    return {
      attempted,
      artifactIds,
      confidence: artifactIds.length > 0 ? 'high' : 'low',
      notes: [`pulled ${artifactIds.length} APK file(s)`],
      errors
    };
  }
};
