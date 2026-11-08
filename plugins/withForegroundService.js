// Declares Notifee's foreground service for Android 14+ (foregroundServiceType
// is mandatory) so AquaGuard can keep watching in the background with a
// permanent notification, and allows urgent alerts to show over the lock screen.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service || []).filter((s) => s.$['android:name'] !== 'app.notifee.core.ForegroundService');
    app.service.push({
      $: {
        'android:name': 'app.notifee.core.ForegroundService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'specialUse',
        'tools:replace': 'android:foregroundServiceType',
      },
      property: [
        {
          $: {
            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': 'Home water-leak monitoring: keeps leak alerts from the home sensors arriving in real time.',
          },
        },
      ],
    });
    return cfg;
  });
};
