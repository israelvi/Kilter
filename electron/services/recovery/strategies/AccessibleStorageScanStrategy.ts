import { join } from 'node:path';
import type { RecoveryStrategy } from '../StrategyEngine';
import { KILTER_FILE_HINTS, INTERESTING_EXTENSIONS } from '../../../models/kilterPackages';

/**
 * Scans publicly accessible storage on the device for Kilter-related files.
 *
 * Two passes:
 *
 *   1. **Targeted package-scoped scan.** For each detected Kilter package,
 *      walk `/sdcard/Android/data/<pkg>/` and `/sdcard/Android/media/<pkg>/`
 *      directly. These paths are tiny, package-specific, and high-confidence
 *      — anything found here was put there by the app itself. On Android 11+
 *      Scoped Storage may block this; we record that honestly per root.
 *
 *   2. **Broad name+extension heuristic scan.** Walks public roots
 *      (`Download`, `Documents`, etc.) with bounded depth, looking for files
 *      whose name matches a Kilter hint AND whose extension is interesting.
 *      Each root runs as its own `find` so a slow one doesn't kill the rest.
 *
 * No private app sandbox is touched. Only world-readable paths.
 */

interface CandidateFile {
  remotePath: string;
  selectionReason: string;
  highConfidence: boolean;
}

export const AccessibleStorageScanStrategy: RecoveryStrategy = {
  id: 'accessible.storage.scan',
  description: 'Scan /sdcard for files whose name matches a Kilter hint and whose extension is interesting',
  requires: ['adb.connected', 'adb.shell', 'sdcard.read', 'adb.pull'],
  async run(ctx) {
    const serial = ctx.session.device.serial;
    const attempted: string[] = [];
    const errors: string[] = [];
    const notes: string[] = [];
    const candidates: CandidateFile[] = [];
    const seen = new Set<string>();

    const addCandidate = (c: CandidateFile) => {
      if (seen.has(c.remotePath)) return;
      seen.add(c.remotePath);
      candidates.push(c);
    };

    // ── Pass 1: targeted scan, scoped to each detected package ──────────
    const targetedRoots: string[] = [];
    for (const pkg of ctx.detectedPackages) {
      targetedRoots.push(`/sdcard/Android/data/${pkg.packageId}`);
      targetedRoots.push(`/sdcard/Android/media/${pkg.packageId}`);
      targetedRoots.push(`/sdcard/Android/obb/${pkg.packageId}`);
    }
    for (const root of targetedRoots) {
      const cmd = `find ${root} -type f 2>/dev/null`;
      attempted.push(`adb shell ${cmd}`);
      const r = await ctx.adb.run(['shell', cmd], { serial, timeoutMs: 30000 });
      if (r.code === 0 && r.stdout.trim()) {
        const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          addCandidate({
            remotePath: line,
            selectionReason: `targeted package-scoped scan: ${root}`,
            highConfidence: true
          });
        }
        notes.push(`targeted scan ${root}: ${lines.length} file(s)`);
      } else if (r.code !== 0 && r.stderr.trim() && !/no such file/i.test(r.stderr)) {
        // "No such file or directory" is a normal miss; suppress.
        // Anything else (e.g. permission denied from Scoped Storage) is worth recording.
        notes.push(`targeted scan ${root}: ${r.stderr.trim().slice(0, 200)}`);
      }
    }

    // ── Pass 2: broad name + extension heuristic, per-root, bounded ─────
    const broadRoots = [
      '/sdcard/Download',
      '/sdcard/Documents',
      '/sdcard/Pictures',
      '/sdcard/Movies',
      '/sdcard/Android/media',
      '/sdcard/DCIM'
    ];
    const namePredicates = KILTER_FILE_HINTS.map((h) => `-iname '*${h}*'`).join(' -o ');

    for (const root of broadRoots) {
      // -maxdepth 4 keeps us out of arbitrarily deep photo subdirs while still
      // catching the typical "AppName/file.ext" two-level layout.
      const cmd = `find ${root} -maxdepth 4 -type f \\( ${namePredicates} \\) 2>/dev/null`;
      attempted.push(`adb shell ${cmd}`);
      const r = await ctx.adb.run(['shell', cmd], { serial, timeoutMs: 45000 });
      if (r.code !== 0 && r.stderr.trim() && !/timeout/i.test(r.stderr)) {
        errors.push(`broad scan ${root}: ${r.stderr.trim().slice(0, 200)}`);
      }
      if (r.stderr.toLowerCase().includes('timeout')) {
        errors.push(`broad scan ${root}: timeout — partial results may be missing`);
      }
      const lines = r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((p) => INTERESTING_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)));
      for (const line of lines) {
        const matchedHint = KILTER_FILE_HINTS.find((h) => line.toLowerCase().includes(h)) ?? 'unknown';
        addCandidate({
          remotePath: line,
          selectionReason: `broad scan ${root}: name=${matchedHint} + ext`,
          highConfidence: false
        });
      }
      notes.push(`broad scan ${root}: ${lines.length} match(es)`);
    }

    ctx.emitProgress(`storage scan: ${candidates.length} candidate file(s) total`);

    // ── Pull every candidate ────────────────────────────────────────────
    const artifactIds: string[] = [];
    for (const c of candidates) {
      const safeName = c.remotePath.replace(/[\\/:*?"<>|]/g, '_');
      const local = join(ctx.session.workspaceDir, 'raw', `sdcard__${safeName}`);
      const pull = await ctx.adb.pull(serial, c.remotePath, local);
      if (pull.code !== 0) {
        errors.push(`failed to pull ${c.remotePath}: ${pull.stderr.trim() || pull.code}`);
        continue;
      }
      const rec = await ctx.registerArtifact({
        sourceDevicePath: c.remotePath,
        hostPath: local,
        fileName: safeName,
        size: 0,
        inferredType: null,
        magic: null,
        strategyId: 'accessible.storage.scan',
        acquisitionMethod: 'adb pull (find on /sdcard)',
        capturedAt: new Date().toISOString(),
        selectionReason: c.selectionReason
      });
      artifactIds.push(rec.id);
    }

    return {
      attempted,
      artifactIds,
      confidence: artifactIds.length > 0
        ? (candidates.some((c) => c.highConfidence) ? 'high' : 'medium')
        : 'low',
      notes: [
        `${candidates.length} candidate(s), ${artifactIds.length} pulled`,
        ...notes
      ],
      errors
    };
  }
};
