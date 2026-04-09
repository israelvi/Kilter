// Shared types — imported by both main and renderer (type-only from renderer).
// Keep this file dependency-free so it stays portable.

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type Capability =
  | 'adb.connected'
  | 'adb.shell'
  | 'adb.pull'
  | 'pm.list'
  | 'pm.path'
  | 'dumpsys.package'
  | 'backup.api'
  | 'sdcard.read'
  | 'appdata.legacy.read'
  | 'mediastore.query'
  | 'root';

export interface AdbBinaryInfo {
  /** Resolved absolute path to the adb binary, if found. */
  path: string | null;
  /** `adb version` output, if found. */
  version: string | null;
  /** Where we found it. */
  source: 'setting' | 'env' | 'sdk' | 'path' | 'not-found';
}

export type DeviceAuthState =
  | 'device'           // authorized
  | 'unauthorized'     // user has not approved the host key
  | 'offline'          // device is offline
  | 'no permissions'   // host has no permission (linux udev typically)
  | 'recovery'
  | 'sideload'
  | 'unknown';

export interface AdbDevice {
  serial: string;
  state: DeviceAuthState;
  /** Optional descriptors `adb devices -l` returns: model, product, transport_id, etc. */
  descriptors: Record<string, string>;
}

export interface DeviceProfile {
  serial: string;
  model: string | null;
  manufacturer: string | null;
  brand: string | null;
  androidVersion: string | null;       // e.g. "13"
  sdkInt: number | null;               // e.g. 33
  buildFingerprint: string | null;
  abi: string | null;
  /** When the profile was captured. */
  capturedAt: string;
}

export interface PackageInfo {
  packageId: string;
  versionName: string | null;
  versionCode: string | null;
  firstInstallTime: string | null;
  lastUpdateTime: string | null;
  /** Manifest flags surfaced by `dumpsys package`. */
  flags: string[];
  allowBackup: boolean | null;
  debuggable: boolean | null;
  /** Path on the device of the APK(s). */
  apkPaths: string[];
}

export type StrategyStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'skipped';

export interface StrategyResult {
  strategyId: string;
  status: StrategyStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Capabilities the strategy required. */
  required: Capability[];
  /** Capabilities that were missing, if any (and therefore caused a skip). */
  missing: Capability[];
  /** Human-readable description of what the strategy attempted. */
  attempted: string[];
  /** Artifact records the strategy registered. */
  artifactIds: string[];
  /** Confidence the strategy itself assigns to its findings. */
  confidence: ConfidenceLevel;
  notes: string[];
  errors: string[];
}

export interface ArtifactRecord {
  id: string;                         // sha256-prefixed unique id
  sessionId: string;
  /** Where the file came from on the device. */
  sourceDevicePath: string | null;
  /** Where we copied it to on the host. */
  hostPath: string;
  fileName: string;
  size: number;
  sha256: string;
  /** Best-guess MIME / file family. */
  inferredType: string | null;
  /** Magic-byte fingerprint we sniffed. */
  magic: string | null;
  /** Strategy that produced this artifact. */
  strategyId: string;
  acquisitionMethod: string;          // e.g. "adb pull", "adb backup"
  capturedAt: string;
  /** A note about the heuristic that selected this file (e.g. "name match: kilter"). */
  selectionReason: string | null;
}

export type EntityType =
  | 'unknown'
  | 'app.metadata'
  | 'user.profile'
  | 'user.account'
  | 'climb.problem'
  | 'climb.ascent'
  | 'climb.attempt'
  | 'board.layout'
  | 'board.set'
  | 'config'
  | 'sync.metadata'
  | 'cache.api'
  | 'log';

export interface ParsedEntity {
  type: EntityType;
  /** Free-form data — we do not yet know real schemas. */
  data: Record<string, unknown>;
  confidence: ConfidenceLevel;
}

export interface ParsedArtifact {
  artifactId: string;
  parserId: string;
  parsedAt: string;
  /** Schema-level summary, e.g. "sqlite db, 12 tables: users, problems, ascents..." */
  summary: string;
  entities: ParsedEntity[];
  warnings: string[];
  errors: string[];
}

export interface RecoverySession {
  id: string;
  createdAt: string;
  device: DeviceProfile;
  capabilities: Record<Capability, boolean>;
  detectedPackages: PackageInfo[];
  strategyResults: StrategyResult[];
  artifacts: ArtifactRecord[];
  parsed: ParsedArtifact[];
  /** Workspace directory on the host where this session writes things. */
  workspaceDir: string;
  /** Path to the NDJSON log for this session. */
  logFile: string;
}

export interface ExportBundleInfo {
  bundleDir: string;
  files: string[];
  createdAt: string;
}

export interface LogEntry {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface AdbCommandResult {
  command: string;
  args: string[];
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

import type { CatalogIpc } from './catalogTypes';

/* Renderer-visible IPC surface. Keep in sync with preload.ts. */
export interface KilterIpc {
  catalog: CatalogIpc;
  adb: {
    detect(): Promise<AdbBinaryInfo>;
    setBinaryPath(path: string): Promise<AdbBinaryInfo>;
    listDevices(): Promise<AdbDevice[]>;
    startServer(): Promise<{ ok: boolean; error?: string }>;
  };
  session: {
    start(serial: string): Promise<RecoverySession>;
    runStrategies(sessionId: string): Promise<RecoverySession>;
    get(sessionId: string): Promise<RecoverySession | null>;
    list(): Promise<RecoverySession[]>;
    export(sessionId: string, targetDir: string): Promise<ExportBundleInfo>;
  };
  diagnostics: {
    tail(limit?: number): Promise<LogEntry[]>;
  };
  dialog: {
    pickDirectory(): Promise<string | null>;
    pickFile(): Promise<string | null>;
  };
  events: {
    onSessionProgress(cb: (payload: { sessionId: string; phase: string; message: string }) => void): () => void;
    onLog(cb: (entry: LogEntry) => void): () => void;
    onExportProgress(cb: (payload: { current: number; total: number; boardName: string; percent: number }) => void): () => void;
  };
}
