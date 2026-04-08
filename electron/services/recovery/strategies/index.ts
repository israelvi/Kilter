import type { RecoveryStrategy } from '../StrategyEngine';
import { DeviceProfileStrategy } from './DeviceProfileStrategy';
import { PackageDetectionStrategy } from './PackageDetectionStrategy';
import { ApkExtractStrategy } from './ApkExtractStrategy';
import { AccessibleStorageScanStrategy } from './AccessibleStorageScanStrategy';
import { DumpsysIntelStrategy } from './DumpsysIntelStrategy';

/**
 * Default strategy ordering. Order matters: later strategies depend on
 * findings from earlier ones (e.g. apk.extract needs detected packages).
 *
 * Adding a new strategy is a one-line change here.
 */
export const DEFAULT_STRATEGIES: RecoveryStrategy[] = [
  DeviceProfileStrategy,
  PackageDetectionStrategy,
  ApkExtractStrategy,
  DumpsysIntelStrategy,
  AccessibleStorageScanStrategy
];

export {
  DeviceProfileStrategy,
  PackageDetectionStrategy,
  ApkExtractStrategy,
  AccessibleStorageScanStrategy,
  DumpsysIntelStrategy
};
