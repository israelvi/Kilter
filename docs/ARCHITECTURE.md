# Architecture

## Goals

- Modular boundaries that survive being torn apart and replaced.
- Honest reporting: every recovered datum carries provenance.
- Graceful degradation: every recovery path declares its capability requirements and reports what it could and could not do.
- Pluggability: adding a strategy or parser is a single-file change plus a registry line.

## Process model (Electron)

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React)                                            │
│   screens/    components/    state/    ipc/                 │
│        │            │           │         │                │
│        └────────────┴───────────┴─────────┘                 │
│                       │                                     │
│                       ▼                                     │
│             window.kilter.* (typed)                         │
└────────────────────────│────────────────────────────────────┘
                         │   contextBridge (preload.ts)
┌────────────────────────▼────────────────────────────────────┐
│ Main process (Node)                                         │
│                                                             │
│   ipc.ts          ◄── single registration point             │
│      │                                                      │
│      ├── AdbService (spawns real adb binary)                │
│      ├── RecoverySessionStore                               │
│      ├── StrategyEngine                                     │
│      │     └── strategies/*                                 │
│      ├── ParserRegistry                                     │
│      │     └── parsers/*                                    │
│      ├── ExportService                                      │
│      └── Logger (NDJSON, in-memory tail for UI)             │
└─────────────────────────────────────────────────────────────┘
```

The renderer **never** imports anything from `electron/`. Only the type files in `electron/models/` are shared (compile-time only).

## Module responsibilities

### `electron/services/adb`

Wraps a real `adb` binary as a child process. Resolves the binary from:

1. Explicit user setting (`appData/kilter-recovery-kit/settings.json`)
2. `ADB_PATH` env var
3. Common Android SDK install locations
4. `PATH`

Exposes a structured `runAdb(args, opts)` that returns `{ stdout, stderr, code, durationMs, command }`. Every invocation is logged. No string parsing leaks out of this module — parsing of `getprop`, `pm list packages`, `dumpsys package`, etc. lives in dedicated parsers under `adb/parse/`.

### `electron/services/recovery`

- **`RecoverySession`** — the unit of work. Created when the user starts a scan. Holds device profile, capability map, strategy results, artifact records, parsed artifacts, log refs.
- **`StrategyEngine`** — registers strategies, resolves dependency order, runs them, collects `StrategyResult`s. Catches and records errors per strategy; one failing strategy never fails the session.
- **`strategies/`** — see [STRATEGY_MATRIX.md](STRATEGY_MATRIX.md). Each strategy declares `id`, `requires: Capability[]`, `run(ctx)`.

### `electron/services/parsers`

Each parser implements:

```ts
interface ArtifactParser {
  id: string;
  probe(file: ProbedFile): Promise<ParserMatch | null>;  // cheap check
  parse(file: ProbedFile, ctx: ParseContext): Promise<ParsedArtifact>;
}
```

Registry order matters: more specific parsers (SQLite, SharedPrefs XML) probe before the generic binary parser.

### `electron/services/export`

Writes a self-contained directory:

```
KilterRecovery_<deviceSerial>_<timestamp>/
  raw/                 verbatim copies, named by sha256 prefix
  parsed/              normalized JSON per artifact
  session.json         the full RecoverySession
  report.json          machine-readable summary
  report.md            human-readable summary
  logs.ndjson          structured logs for this session
```

### `electron/services/logging`

NDJSON file logger plus a bounded in-memory ring buffer the renderer can pull for the Diagnostics screen. Every log entry has `ts`, `level`, `scope`, `msg`, `data`.

## Data flow: a typical scan

1. UI calls `kilter.adb.detect()` — main resolves the binary, returns version.
2. UI calls `kilter.adb.listDevices()` — returns devices with auth state.
3. UI calls `kilter.session.start(serial)` — main creates a `RecoverySession`, gathers `DeviceProfile` via `getprop`, returns the session id.
4. UI calls `kilter.session.runStrategies(sessionId)` — engine runs strategies sequentially, streams progress events back through `kilter.events.on('session.progress', …)`.
5. Each strategy that produces files registers `ArtifactRecord`s. After all strategies finish, the engine pipes artifacts through the parser registry and stores `ParsedArtifact`s.
6. UI reads results via `kilter.session.get(sessionId)` and renders them.
7. UI calls `kilter.session.export(sessionId, dir)` — `ExportService` writes the bundle.

## Type discipline

- `electron/models/types.ts` is the single source of truth for shared types.
- Renderer imports types via a type-only import (`import type { … }`).
- `tsconfig.json` `composite` references keep main and renderer compiles independent.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer.
- Preload exposes a tightly typed surface — no `ipcRenderer` leaks.
- All file paths the renderer can act on are validated against an allowlist (the user's selected export directory only).
- ADB commands are constructed from a fixed allowlist of subcommands; user input is never concatenated into shell strings.
