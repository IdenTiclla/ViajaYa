/** Keep optional social SDKs dormant until the user explicitly requests sign-in. */
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

module.exports = function withSocialSdkDefaults(config) {
  config = withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application[0];
    const names = [
      'com.facebook.sdk.AutoInitEnabled',
      'com.facebook.sdk.AutoLogAppEventsEnabled',
      'com.facebook.sdk.AdvertiserIDCollectionEnabled',
    ];
    application['meta-data'] = (application['meta-data'] ?? []).filter(
      (item) => !names.includes(item.$['android:name']),
    );
    application['meta-data'].push(...names.map((name) => ({
      $: { 'android:name': name, 'android:value': 'false' },
    })));
    return result;
  });
  return withInfoPlist(config, (result) => {
    Object.assign(result.modResults, {
      FacebookAutoInitEnabled: false, FacebookAutoLogAppEventsEnabled: false,
      FacebookAdvertiserIDCollectionEnabled: false,
    });
    return result;
  });
};
