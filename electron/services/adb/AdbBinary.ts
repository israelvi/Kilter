import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import type { AdbBinaryInfo } from '../../models/types';

const EXE = platform() === 'win32' ? 'adb.exe' : 'adb';

/**
 * Resolves an `adb` binary in this priority order:
 *   1. explicit override (from settings)
 *   2. ADB_PATH env var
 *   3. common Android SDK install locations
 *   4. PATH
 *
 * Validates the candidate by running `adb version` and capturing the version line.
 */
export async function resolveAdbBinary(override?: string | null): Promise<AdbBinaryInfo> {
  const candidates: Array<{ path: string; source: AdbBinaryInfo['source'] }> = [];

  if (override && override.trim().length > 0) {
    candidates.push({ path: override, source: 'setting' });
  }

  const envPath = process.env.ADB_PATH;
  if (envPath && envPath.trim().length > 0) {
    candidates.push({ path: envPath, source: 'env' });
  }

  for (const sdkPath of commonSdkLocations()) {
    candidates.push({ path: join(sdkPath, 'platform-tools', EXE), source: 'sdk' });
  }

  // Last resort: rely on PATH lookup. We push the bare name and let spawn resolve it.
  candidates.push({ path: EXE, source: 'path' });

  for (const c of candidates) {
    // For non-bare paths, verify the file exists before spawning.
    if (c.path !== EXE) {
      try {
        await fs.access(c.path);
      } catch {
        continue;
      }
    }
    const version = await tryGetVersion(c.path);
    if (version != null) {
      return { path: c.path === EXE ? EXE : c.path, version, source: c.source };
    }
  }

  return { path: null, version: null, source: 'not-found' };
}

function commonSdkLocations(): string[] {
  const home = homedir();
  const list: string[] = [];
  if (platform() === 'win32') {
    if (process.env.LOCALAPPDATA) {
      list.push(join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
      // Google.PlatformTools installed via winget — note: adb.exe lives directly under platform-tools/
      // not under platform-tools/platform-tools/, so we push the parent and let the join below handle it.
      list.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe'));
      // WinGet command alias shim folder (added to PATH on install).
      list.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    }
    if (process.env.USERPROFILE) list.push(join(process.env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk'));
    list.push('C:\\Android\\Sdk');
    list.push('C:\\Program Files\\Android\\android-sdk');
    list.push('C:\\Program Files (x86)\\Android\\android-sdk');
  } else if (platform() === 'darwin') {
    list.push(join(home, 'Library', 'Android', 'sdk'));
    list.push('/usr/local/share/android-sdk');
    list.push('/opt/homebrew/share/android-commandlinetools');
  } else {
    list.push(join(home, 'Android', 'Sdk'));
    list.push('/usr/lib/android-sdk');
    list.push('/opt/android-sdk');
  }
  if (process.env.ANDROID_HOME) list.unshift(process.env.ANDROID_HOME);
  if (process.env.ANDROID_SDK_ROOT) list.unshift(process.env.ANDROID_SDK_ROOT);
  return list;
}

function tryGetVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (val: string | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    let child;
    try {
      child = spawn(path, ['version'], { windowsHide: true });
    } catch {
      finish(null);
      return;
    }
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code === 0) {
        const out = (stdout || stderr).trim();
        const firstLine = out.split('\n').find((l) => l.trim().length > 0) ?? null;
        finish(firstLine);
      } else {
        finish(null);
      }
    });
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(null);
    }, 5000);
  });
}
