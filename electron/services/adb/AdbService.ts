import { spawn } from 'node:child_process';
import { promises as fs, createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  AdbBinaryInfo,
  AdbCommandResult,
  AdbDevice,
  DeviceAuthState,
  DeviceProfile,
  PackageInfo
} from '../../models/types';
import { resolveAdbBinary } from './AdbBinary';
import type { Logger } from '../logging/Logger';

export interface AdbRunOptions {
  /** If set, send these args to a specific device serial. */
  serial?: string;
  /** Timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Capture stdout into a file instead of memory (for large pulls). */
  toFile?: string;
}

/**
 * Thin, well-typed wrapper around the real `adb` binary.
 *
 * - Resolves the binary lazily and caches it.
 * - Every command goes through `run()` which logs args, exit code, duration.
 * - User input is never concatenated into a shell — args are passed as an
 *   array to spawn() directly.
 */
export class AdbService {
  private binary: AdbBinaryInfo = { path: null, version: null, source: 'not-found' };
  private override: string | null = null;

  constructor(private logger: Logger) {}

  async detect(force = false): Promise<AdbBinaryInfo> {
    if (force || !this.binary.path) {
      this.binary = await resolveAdbBinary(this.override);
      this.logger.info('adb', 'binary resolved', {
        path: this.binary.path,
        version: this.binary.version,
        source: this.binary.source
      });
    }
    return this.binary;
  }

  async setBinaryPath(path: string): Promise<AdbBinaryInfo> {
    this.override = path;
    return this.detect(true);
  }

  getBinary(): AdbBinaryInfo {
    return this.binary;
  }

  /**
   * Run an adb subcommand. Returns structured result. Never throws on
   * non-zero exit; the caller decides what counts as failure.
   */
  async run(args: string[], opts: AdbRunOptions = {}): Promise<AdbCommandResult> {
    const bin = await this.detect();
    if (!bin.path) {
      const fakeResult: AdbCommandResult = {
        command: 'adb',
        args,
        code: -1,
        stdout: '',
        stderr: 'adb binary not found',
        durationMs: 0
      };
      this.logger.error('adb', 'cannot run, binary missing', { args });
      return fakeResult;
    }
    const fullArgs = opts.serial ? ['-s', opts.serial, ...args] : args;
    const start = Date.now();
    return new Promise<AdbCommandResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let fileStream: import('node:fs').WriteStream | null = null;
      let settled = false;

      const finish = async (code: number | null) => {
        if (settled) return;
        settled = true;
        try { fileStream?.end(); } catch { /* ignore */ }
        const result: AdbCommandResult = {
          command: bin.path!,
          args: fullArgs,
          code,
          stdout,
          stderr,
          durationMs: Date.now() - start
        };
        this.logger.debug('adb', 'command finished', {
          args: fullArgs,
          code,
          durationMs: result.durationMs,
          stderrPreview: stderr.slice(0, 200)
        });
        resolve(result);
      };

      let child;
      try {
        child = spawn(bin.path!, fullArgs, { windowsHide: true });
      } catch (err) {
        stderr = err instanceof Error ? err.message : String(err);
        finish(-1);
        return;
      }
      this.logger.debug('adb', 'command started', { args: fullArgs });

      if (opts.toFile) {
        try {
          mkdirSync(dirname(opts.toFile), { recursive: true });
          fileStream = createWriteStream(opts.toFile);
          child.stdout?.pipe(fileStream);
        } catch (err) {
          stderr += `\n[file capture failed: ${err instanceof Error ? err.message : String(err)}]`;
        }
      } else {
        child.stdout?.on('data', (d) => { stdout += d.toString(); });
      }
      child.stderr?.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => {
        stderr += '\n' + (err instanceof Error ? err.message : String(err));
        finish(-1);
      });
      child.on('close', (code) => finish(code));

      const timeoutMs = opts.timeoutMs ?? 30000;
      setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        stderr += `\n[timeout after ${timeoutMs}ms]`;
        finish(-1);
      }, timeoutMs);
    });
  }

  async startServer(): Promise<{ ok: boolean; error?: string }> {
    const r = await this.run(['start-server']);
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr || 'failed to start server' };
  }

  async listDevices(): Promise<AdbDevice[]> {
    const r = await this.run(['devices', '-l']);
    if (r.code !== 0) return [];
    return parseAdbDevicesL(r.stdout);
  }

  async getProp(serial: string, key: string): Promise<string | null> {
    const r = await this.run(['shell', 'getprop', key], { serial });
    if (r.code !== 0) return null;
    const val = r.stdout.trim();
    return val.length === 0 ? null : val;
  }

  async getDeviceProfile(serial: string): Promise<DeviceProfile> {
    const [model, manufacturer, brand, version, sdk, fingerprint, abi] = await Promise.all([
      this.getProp(serial, 'ro.product.model'),
      this.getProp(serial, 'ro.product.manufacturer'),
      this.getProp(serial, 'ro.product.brand'),
      this.getProp(serial, 'ro.build.version.release'),
      this.getProp(serial, 'ro.build.version.sdk'),
      this.getProp(serial, 'ro.build.fingerprint'),
      this.getProp(serial, 'ro.product.cpu.abi')
    ]);
    return {
      serial,
      model,
      manufacturer,
      brand,
      androidVersion: version,
      sdkInt: sdk ? Number.parseInt(sdk, 10) : null,
      buildFingerprint: fingerprint,
      abi,
      capturedAt: new Date().toISOString()
    };
  }

  /** Returns the list of installed packages. */
  async listPackages(serial: string): Promise<string[]> {
    const r = await this.run(['shell', 'pm', 'list', 'packages'], { serial });
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('package:'))
      .map((l) => l.slice('package:'.length));
  }

  /** Returns rich info for a package, including allowBackup / debuggable flags. */
  async getPackageInfo(serial: string, pkg: string): Promise<PackageInfo | null> {
    const dump = await this.run(['shell', 'dumpsys', 'package', pkg], { serial });
    if (dump.code !== 0 || !dump.stdout.includes(pkg)) return null;
    const text = dump.stdout;

    const versionName = matchOne(text, /versionName=([^\s]+)/);
    const versionCode = matchOne(text, /versionCode=(\d+)/);
    const firstInstall = matchOne(text, /firstInstallTime=([^\n]+)/);
    const lastUpdate = matchOne(text, /lastUpdateTime=([^\n]+)/);
    const flagsLine = matchOne(text, /flags=\[\s*([^\]]*)\]/) ?? '';
    const flags = flagsLine.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    const allowBackup = /ALLOW_BACKUP/.test(flagsLine) ? true : /ALLOW_BACKUP/.test(text) ? true : flagsLine ? false : null;
    const debuggable = /DEBUGGABLE/.test(flagsLine) ? true : flagsLine ? false : null;

    const pathRes = await this.run(['shell', 'pm', 'path', pkg], { serial });
    const apkPaths = pathRes.code === 0
      ? pathRes.stdout.split('\n').map((l) => l.trim())
          .filter((l) => l.startsWith('package:'))
          .map((l) => l.slice('package:'.length))
      : [];

    return {
      packageId: pkg,
      versionName,
      versionCode,
      firstInstallTime: firstInstall,
      lastUpdateTime: lastUpdate,
      flags,
      allowBackup,
      debuggable,
      apkPaths
    };
  }

  /** Pull a remote file to a local path. Creates parent dirs as needed. */
  async pull(serial: string, remotePath: string, localPath: string): Promise<AdbCommandResult> {
    await fs.mkdir(dirname(localPath), { recursive: true });
    return this.run(['pull', remotePath, localPath], { serial, timeoutMs: 120000 });
  }
}

function matchOne(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** Parse `adb devices -l` output. */
export function parseAdbDevicesL(stdout: string): AdbDevice[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const devices: AdbDevice[] = [];
  for (const line of lines) {
    if (line.startsWith('List of devices')) continue;
    if (line.startsWith('*')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const stateRaw = parts[1];
    const state = normalizeState(stateRaw);
    const descriptors: Record<string, string> = {};
    for (const p of parts.slice(2)) {
      const eq = p.indexOf(':');
      if (eq > 0) descriptors[p.slice(0, eq)] = p.slice(eq + 1);
    }
    devices.push({ serial, state, descriptors });
  }
  return devices;
}

function normalizeState(s: string): DeviceAuthState {
  switch (s) {
    case 'device': return 'device';
    case 'unauthorized': return 'unauthorized';
    case 'offline': return 'offline';
    case 'no': return 'no permissions'; // "no permissions" comes through as multi-token
    case 'recovery': return 'recovery';
    case 'sideload': return 'sideload';
    default: return 'unknown';
  }
}
