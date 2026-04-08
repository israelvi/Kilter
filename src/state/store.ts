import { useSyncExternalStore } from 'react';
import type {
  AdbBinaryInfo,
  AdbDevice,
  LogEntry,
  RecoverySession
} from '@models/types';

export type Screen =
  | 'welcome'
  | 'connect'
  | 'device'
  | 'kilter'
  | 'strategies'
  | 'findings'
  | 'export'
  | 'diagnostics'
  | 'boards'
  | 'climbs'
  | 'climb-detail'
  | 'ios-coming-soon';

export interface AppState {
  screen: Screen;
  adb: AdbBinaryInfo | null;
  devices: AdbDevice[];
  selectedSerial: string | null;
  session: RecoverySession | null;
  isScanning: boolean;
  progress: string[];
  logs: LogEntry[];
  /** Catalog browser state. */
  selectedComboId: number | null;
  selectedClimbUuid: string | null;
}

const initial: AppState = {
  screen: 'welcome',
  adb: null,
  devices: [],
  selectedSerial: null,
  session: null,
  isScanning: false,
  progress: [],
  logs: [],
  selectedComboId: null,
  selectedClimbUuid: null
};

let state: AppState = initial;
const listeners = new Set<() => void>();

function set(partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof partial === 'function' ? partial(state) : partial;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const store = {
  get: () => state,
  set,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }
};

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(initial));
}
