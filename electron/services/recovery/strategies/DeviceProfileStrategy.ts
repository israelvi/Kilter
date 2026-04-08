import type { RecoveryStrategy } from '../StrategyEngine';

/**
 * Always-first strategy: confirms basic shell access and refreshes the
 * device profile. The session was created with a profile already, but
 * running this proves shell works and surfaces any change.
 */
export const DeviceProfileStrategy: RecoveryStrategy = {
  id: 'device.profile',
  description: 'Capture device model, Android version, SDK level, build fingerprint, and ABI',
  requires: ['adb.connected', 'adb.shell'],
  async run(ctx) {
    const profile = await ctx.adb.getDeviceProfile(ctx.session.device.serial);
    await ctx.store.update(ctx.session.id, (s) => { s.device = profile; });
    ctx.emitProgress(`profile: ${profile.manufacturer ?? '?'} ${profile.model ?? '?'} (Android ${profile.androidVersion ?? '?'} / SDK ${profile.sdkInt ?? '?'})`);
    return {
      attempted: ['getprop ro.product.model, ro.build.version.release, ro.build.version.sdk, ro.build.fingerprint, ro.product.cpu.abi'],
      artifactIds: [],
      confidence: 'high',
      notes: [`Android ${profile.androidVersion ?? 'unknown'} (SDK ${profile.sdkInt ?? '?'}) on ${profile.manufacturer ?? '?'} ${profile.model ?? '?'}`],
      errors: []
    };
  }
};
