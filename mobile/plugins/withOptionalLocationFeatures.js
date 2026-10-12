/**
 * Declares the location hardware features as optional.
 *
 * `ACCESS_FINE_LOCATION` makes Android imply `android.hardware.location.gps` as REQUIRED,
 * and Google Play then hides the app from every device without GPS (Wi-Fi tablets,
 * some Chromebooks). Declaring the features with `required="false"` keeps the app
 * installable everywhere; the app itself detects at runtime whether it can locate.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const OPTIONAL_FEATURES = [
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.location.network',
];

module.exports = function withOptionalLocationFeatures(config) {
  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    manifest['uses-feature'] ??= [];
    for (const name of OPTIONAL_FEATURES) {
      const existing = manifest['uses-feature'].find((feature) => feature.$['android:name'] === name);
      if (existing) {
        existing.$['android:required'] = 'false';
      } else {
        manifest['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } });
      }
    }
    return result;
  });
};
