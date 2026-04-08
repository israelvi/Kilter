import type { RecoveryStrategy } from '../StrategyEngine';
import { KNOWN_KILTER_PACKAGES, KILTER_PACKAGE_HINTS } from '../../../models/kilterPackages';
import type { PackageInfo } from '../../../models/types';

/**
 * Detects whether any known or hint-matched Kilter package id is currently
 * installed on the device. For each match, runs `dumpsys package` to capture
 * version, install time, allowBackup and debuggable flags, and APK path.
 */
export const PackageDetectionStrategy: RecoveryStrategy = {
  id: 'package.detection',
  description: 'Search installed packages for known and likely Kilter Board package ids',
  requires: ['adb.connected', 'pm.list'],
  async run(ctx) {
    const all = await ctx.adb.listPackages(ctx.session.device.serial);
    ctx.emitProgress(`enumerated ${all.length} packages`);

    const matches = new Set<string>();
    for (const pkg of KNOWN_KILTER_PACKAGES) if (all.includes(pkg)) matches.add(pkg);
    for (const pkg of all) {
      const lower = pkg.toLowerCase();
      if (KILTER_PACKAGE_HINTS.some((h) => lower.includes(h))) matches.add(pkg);
    }

    const detected: PackageInfo[] = [];
    for (const pkg of matches) {
      const info = await ctx.adb.getPackageInfo(ctx.session.device.serial, pkg);
      if (info) detected.push(info);
    }

    if (detected.length > 0) {
      await ctx.store.update(ctx.session.id, (s) => { s.detectedPackages = detected; });
      // Mirror into ctx so later strategies can see them.
      ctx.detectedPackages.length = 0;
      ctx.detectedPackages.push(...detected);
    }

    const notes: string[] = [];
    if (detected.length === 0) {
      notes.push('no Kilter-related packages currently installed (the app may have been uninstalled — leftover-storage strategies may still find traces)');
    } else {
      for (const p of detected) {
        notes.push(`found: ${p.packageId} v${p.versionName ?? '?'} (allowBackup=${p.allowBackup ?? '?'}, debuggable=${p.debuggable ?? '?'})`);
      }
    }

    return {
      attempted: ['pm list packages', 'dumpsys package <each candidate>', 'pm path <each candidate>'],
      artifactIds: [],
      confidence: detected.length > 0 ? 'high' : 'medium',
      notes,
      errors: []
    };
  }
};
