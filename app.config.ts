import type { ExpoConfig } from 'expo/config';

/**
 * Replaces app.json so the config can contain logic (app.json is static JSON).
 *
 * Network lock-down: this app makes no network calls, so release builds
 * (preview / production) have INTERNET, ACCESS_NETWORK_STATE and
 * SYSTEM_ALERT_WINDOW REMOVED from the final merged manifest - the app cannot
 * open a socket at all. Development builds need INTERNET to reach the Metro
 * bundler (and SYSTEM_ALERT_WINDOW for the dev-menu overlay), so the lock-down
 * is skipped when EAS_BUILD_PROFILE === 'development' (set by eas.json) or when
 * ALLOW_DEV_NETWORK=1 is exported for a local `expo prebuild` / `expo run:android`.
 */
const isDevBuild =
  process.env.EAS_BUILD_PROFILE === 'development' ||
  process.env.ALLOW_DEV_NETWORK === '1';

const config: ExpoConfig = {
  name: 'My Todo List',
  slug: 'my-todo-list',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/icon.png',
  scheme: 'learningtodo',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
  },
  android: {
    // DELIBERATELY unchanged when the app was renamed to "My Todo List". A
    // package name is the app's identity: Android keys installs, permissions
    // and data on it, and Google Play fixes it permanently at the first
    // upload. Renaming it would make this a different app that cannot upgrade
    // over the installed one. The `scheme` is left alone for the same reason —
    // anything holding a deep link binds to it.
    package: 'ro.dbg.learningtodo',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: true,
    permissions: [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.SCHEDULE_EXACT_ALARM',
    ],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      ...(isDevBuild
        ? []
        : [
            'android.permission.INTERNET',
            'android.permission.ACCESS_NETWORK_STATE',
            'android.permission.SYSTEM_ALERT_WINDOW',
          ]),
    ],
  },
  plugins: [
    'expo-sqlite',
    'expo-system-ui',
    ['expo-notifications', { defaultChannel: 'reminders' }],
    ['expo-build-properties', { android: { targetSdkVersion: 36 } }],
    'expo-status-bar',
    '@react-native-community/datetimepicker',
  ],
};

export default config;
