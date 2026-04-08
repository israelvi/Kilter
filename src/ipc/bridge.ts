import type { KilterIpc } from '@models/types';

/**
 * Tiny accessor that fails loudly if the preload bridge is missing.
 * This is the only place in the renderer that touches `window.kilter`.
 */
export function ipc(): KilterIpc {
  const k = (window as unknown as { kilter?: KilterIpc }).kilter;
  if (!k) {
    throw new Error('window.kilter is not defined — preload script did not run');
  }
  return k;
}
