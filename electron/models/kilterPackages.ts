// Known and candidate Kilter Board package identifiers.
//
// IMPORTANT: As of Phase 1, these are educated guesses pending real-device
// validation. The first entry is the strongest candidate based on common
// Android package naming conventions for the publisher. The remaining
// entries are heuristics — substrings the package detector will also try.
//
// To validate: install the legacy Kilter Board APK on a real device and run
// `adb shell pm list packages | grep -i kilter` and `adb shell pm list packages | grep -i auroraclimbing`.
// Update this file with the confirmed id and remove the rest.

export const KNOWN_KILTER_PACKAGES: readonly string[] = [
  'com.auroraclimbing.kilterboard',
  'com.kilterboardapp',
  'com.kilter.kilterboard',
  'com.kilterboard.app'
];

/** Substrings used for fuzzy detection in `pm list packages` output. */
export const KILTER_PACKAGE_HINTS: readonly string[] = [
  'kilter',
  'auroraclimbing',
  'auroraboard'
];

/** Filename / path heuristics used by the accessible-storage scanner. */
export const KILTER_FILE_HINTS: readonly string[] = [
  'kilter',
  'aurora',
  'climb',
  'ascent',
  'problem',
  'board'
];

/** File extensions worth probing if a name hint also matches. */
export const INTERESTING_EXTENSIONS: readonly string[] = [
  '.db', '.sqlite', '.sqlite3',
  '.json', '.xml', '.plist',
  '.realm',
  '.pb', '.proto', '.bin',
  '.log', '.txt', '.csv',
  '.zip', '.tar', '.gz', '.ab'
];
