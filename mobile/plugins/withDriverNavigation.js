/** Reproducible native dependencies for Google Navigation alongside Maps. */
const { withAppBuildGradle, withProjectBuildGradle, withGradleProperties, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

module.exports = function withDriverNavigation(config) {
  config = withAppBuildGradle(config, result => {
    const marker = '// ViajaYa driver navigation';
    if (!result.modResults.contents.includes(marker)) {
      result.modResults.contents += `\n${marker}\nandroid { compileOptions { coreLibraryDesugaringEnabled true } }\ndependencies { coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4' }\n`;
    }
    return result;
  });
  config = withProjectBuildGradle(config, result => {
    const marker = '// Navigation SDK includes the Maps SDK classes';
    if (!result.modResults.contents.includes(marker)) {
      result.modResults.contents += `\n${marker}\nallprojects { configurations.configureEach { resolutionStrategy.dependencySubstitution { substitute module('com.google.android.gms:play-services-maps') using module('com.google.android.libraries.navigation:navigation:7.6.1') } } }\n`;
    }
    return result;
  });
  config = withGradleProperties(config, result => {
    result.modResults = result.modResults.filter(item => item.key !== 'android.enableJetifier');
    result.modResults.push({ type: 'property', key: 'android.enableJetifier', value: 'true' });
    return result;
  });
  config = withAndroidManifest(config, result => {
    const manifest = result.modResults.manifest;
    manifest.queries ??= [];
    if (!manifest.queries.some(query => query.package?.some(item => item.$['android:name'] === 'com.waze'))) {
      manifest.queries.push({ package: [{ $: { 'android:name': 'com.waze' } }] });
    }
    return result;
  });
  return withInfoPlist(config, result => {
    result.modResults.LSApplicationQueriesSchemes = [...new Set([...(result.modResults.LSApplicationQueriesSchemes ?? []), 'waze'])];
    return result;
  });
};
