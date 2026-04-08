import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type { ExportBundleInfo, RecoverySession } from '../../models/types';
import type { Logger } from '../logging/Logger';

export class ExportService {
  constructor(private logger: Logger) {}

  /**
   * Writes a self-contained evidence bundle to `targetDir`:
   *
   *   KilterRecovery_<serial>_<ts>/
   *     raw/         copies of pulled artifacts
   *     parsed/      one normalized JSON per parsed artifact
   *     session.json full session
   *     report.json  machine-readable summary
   *     report.md    human-readable summary
   *     logs.ndjson  copy of the session log if present
   */
  async export(session: RecoverySession, targetDir: string): Promise<ExportBundleInfo> {
    const safeTs = session.createdAt.replace(/[:.]/g, '-');
    const bundleName = `KilterRecovery_${session.device.serial}_${safeTs}`;
    const bundleDir = join(targetDir, bundleName);
    const rawDir = join(bundleDir, 'raw');
    const parsedDir = join(bundleDir, 'parsed');
    await fs.mkdir(rawDir, { recursive: true });
    await fs.mkdir(parsedDir, { recursive: true });

    const writtenFiles: string[] = [];

    // Copy raw artifacts.
    for (const a of session.artifacts) {
      try {
        const dest = join(rawDir, `${a.sha256.slice(0, 12)}_${basename(a.fileName)}`);
        await fs.copyFile(a.hostPath, dest);
        writtenFiles.push(dest);
      } catch (err) {
        this.logger.warn('export', 'failed to copy artifact', { id: a.id, err: String(err) });
      }
    }

    // Write parsed JSON.
    for (const p of session.parsed) {
      const dest = join(parsedDir, `${p.artifactId}__${p.parserId}.json`);
      await fs.writeFile(dest, JSON.stringify(p, null, 2), 'utf8');
      writtenFiles.push(dest);
    }

    // Session and report.
    const sessionPath = join(bundleDir, 'session.json');
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
    writtenFiles.push(sessionPath);

    const reportJson = buildReportJson(session);
    const reportJsonPath = join(bundleDir, 'report.json');
    await fs.writeFile(reportJsonPath, JSON.stringify(reportJson, null, 2), 'utf8');
    writtenFiles.push(reportJsonPath);

    const reportMd = buildReportMarkdown(session);
    const reportMdPath = join(bundleDir, 'report.md');
    await fs.writeFile(reportMdPath, reportMd, 'utf8');
    writtenFiles.push(reportMdPath);

    // Copy logs if they exist.
    try {
      await fs.copyFile(session.logFile, join(bundleDir, 'logs.ndjson'));
      writtenFiles.push(join(bundleDir, 'logs.ndjson'));
    } catch {
      // No log file is acceptable.
    }

    this.logger.info('export', 'bundle written', { bundleDir, fileCount: writtenFiles.length });
    return {
      bundleDir,
      files: writtenFiles,
      createdAt: new Date().toISOString()
    };
  }
}

function buildReportJson(s: RecoverySession) {
  return {
    sessionId: s.id,
    createdAt: s.createdAt,
    device: s.device,
    detectedPackages: s.detectedPackages,
    capabilities: s.capabilities,
    strategySummary: s.strategyResults.map((r) => ({
      id: r.strategyId,
      status: r.status,
      confidence: r.confidence,
      durationMs: r.durationMs,
      artifactCount: r.artifactIds.length,
      missing: r.missing,
      notes: r.notes,
      errors: r.errors
    })),
    artifactCount: s.artifacts.length,
    parsedCount: s.parsed.length
  };
}

function buildReportMarkdown(s: RecoverySession): string {
  const lines: string[] = [];
  lines.push(`# Kilter Recovery Report`);
  lines.push('');
  lines.push(`**Session:** \`${s.id}\``);
  lines.push(`**Created:** ${s.createdAt}`);
  lines.push('');
  lines.push(`## Device`);
  lines.push(`- Serial: \`${s.device.serial}\``);
  lines.push(`- Manufacturer / Model: ${s.device.manufacturer ?? '?'} / ${s.device.model ?? '?'}`);
  lines.push(`- Android: ${s.device.androidVersion ?? '?'} (SDK ${s.device.sdkInt ?? '?'})`);
  lines.push(`- Build fingerprint: ${s.device.buildFingerprint ?? '?'}`);
  lines.push(`- ABI: ${s.device.abi ?? '?'}`);
  lines.push('');
  lines.push(`## Detected Kilter packages`);
  if (s.detectedPackages.length === 0) {
    lines.push(`_None detected. The app may have been uninstalled — leftover-storage strategies may still find traces._`);
  } else {
    for (const p of s.detectedPackages) {
      lines.push(`- **${p.packageId}** v${p.versionName ?? '?'}`);
      lines.push(`  - allowBackup: ${p.allowBackup ?? '?'}, debuggable: ${p.debuggable ?? '?'}`);
      lines.push(`  - first installed: ${p.firstInstallTime ?? '?'}, last updated: ${p.lastUpdateTime ?? '?'}`);
      lines.push(`  - APK paths: ${p.apkPaths.join(', ') || '_(none)_'}`);
    }
  }
  lines.push('');
  lines.push(`## Strategy results`);
  for (const r of s.strategyResults) {
    lines.push(`### ${r.strategyId} — ${r.status}`);
    lines.push(`- duration: ${r.durationMs ?? '?'}ms, confidence: ${r.confidence}, artifacts: ${r.artifactIds.length}`);
    if (r.missing.length) lines.push(`- missing capabilities: ${r.missing.join(', ')}`);
    for (const n of r.notes) lines.push(`- note: ${n}`);
    for (const e of r.errors) lines.push(`- error: ${e}`);
    lines.push('');
  }
  lines.push(`## Artifacts (${s.artifacts.length})`);
  for (const a of s.artifacts) {
    lines.push(`- \`${a.fileName}\` — sha256 ${a.sha256.slice(0, 12)}…, source: ${a.sourceDevicePath ?? 'host-only'}`);
  }
  lines.push('');
  lines.push(`## Parsed artifacts (${s.parsed.length})`);
  for (const p of s.parsed) {
    lines.push(`- **${p.parserId}** on \`${p.artifactId}\`: ${p.summary}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('_Honest uncertainty: this report describes what was found and what was not. Recovery is heuristic and never guaranteed._');
  return lines.join('\n');
}
