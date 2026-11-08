# Learning Todo (Expo + TypeScript, Android only)

A deliberately tiny todo app (add / edit / complete / delete, optional due date,
optional local reminder). It exists to teach the Android-specific parts you
cannot learn from the web: runtime permissions, exact alarms, notification
channels, SQLite schema migrations, edge-to-edge layout, font scaling, dark mode.
It is **not** meant for Google Play. No backend, no accounts, no analytics.

Stack: Expo SDK 58, React Native 0.88, React 19, TypeScript (strict),
`expo-sqlite`, `expo-notifications`, `@react-native-community/datetimepicker`,
`react-native-safe-area-context`, `expo-dev-client`, `expo-build-properties`.

## Where to read first

| File | What it teaches |
| --- | --- |
| `src/notifications/reminders.ts` | Channel, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM: why each exists, what breaks without it |
| `src/db/database.ts` | Migration runner using `PRAGMA user_version`, v1 -> v2 example |
| `src/db/todos.ts` | Parameterised queries, 0/1 booleans, row <-> object mapping |
| `src/components/ReminderBanner.tsx` | Graceful denied / blocked / no-exact-alarm states |
| `src/components/TodoEditor.tsx` | Imperative Android date/time dialogs, safe-area insets |
| `src/theme/colors.ts` | Dark mode palettes (AA contrast), 48dp touch targets |
| `app.config.ts` | Permissions, target SDK 36, plugins, network lock-down in release builds |
| `src/notifications/keyedMutex.ts`, `reconcilePlan.ts` | Pure logic (per-task lock, OS-vs-DB reconcile plan) with tests: `npm test` |

## 1. Install

Requires Node 20+ (tested with Node 22, npm 10).

```bash
cd "/Users/cosmin/work other/Cosmin/15. aplicatie mobila android - todo"
npm install
npm run typecheck      # tsc --noEmit, should print nothing
npm run doctor         # expo-doctor, should say 20/20 checks passed
```

## 2. Run on a physical Android phone (no account needed)

On the phone: Settings > About phone > tap **Build number** 7 times > back to
Settings > System > Developer options > enable **USB debugging** (for USB) .

### Option A: Expo Go (fastest, but limited for this app)

Install "Expo Go" from Google Play on the phone, then:

```bash
npm start -- --go
```

Scan the QR code with Expo Go (phone and computer on the same Wi-Fi). If Wi-Fi
blocks it, use USB instead:

```bash
adb devices                       # phone must be listed as "device"
adb reverse tcp:8081 tcp:8081
npm start -- --go --localhost
```

(`adb` comes with Android platform-tools; `brew install --cask android-platform-tools`.)
`--tunnel` also exists but may ask you to log in to Expo, so avoid it for now.

**Limit of Expo Go:** it is a different app with its own manifest, so it does
**not** carry this project's `SCHEDULE_EXACT_ALARM` declaration or package
name. SQLite, dark mode, font scaling and basic notification permission work;
the exact-alarm flow is not reliably testable there. For the full notification
lesson use Option B or C.

### Option B: development build installed over USB (no Expo account, needs Android Studio SDK)

This compiles the real native app on your Mac. It needs JDK 17 and the Android
SDK (install Android Studio once and let it download SDK Platform 36 / 37).

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools"
npx expo run:android --device          # first build takes several minutes
```

This generates the git-ignored `android/` folder (Continuous Native Generation:
never edit it by hand, change `app.config.ts` and re-run). It uses the real manifest
from `app.config.ts`, so the exact-alarm flow works.

### Option C: the preview APK (see below), once you have an Expo account.

## 3. Build the preview APK with EAS (REQUIRES AN EXPO ACCOUNT)

**These commands need an Expo account, which you do not have yet. Nothing here
has been run.** Free tier is enough.

```bash
npx eas-cli@latest login        # NEEDS EXPO ACCOUNT (create at expo.dev)
npx eas-cli@latest init         # NEEDS ACCOUNT: links the project, writes extra.eas.projectId into app.json (this project now uses app.config.ts: copy the printed `extra.eas.projectId` into it by hand)
npx eas-cli@latest build --platform android --profile preview   # NEEDS ACCOUNT
```

`eas build` runs in Expo's cloud, queues on the free tier, and ends with a
download URL / QR code for an `.apk`. Open it on the phone, allow "Install
unknown apps" for your browser when prompted, and install. The `preview`
profile is `distribution: internal` + `buildType: apk`, so it is signed with an
EAS-managed keystore and is directly sideloadable. The `production` profile
builds an `.aab` and is only needed for Google Play, which you are not using.

Notes:
- The first build asks whether to generate an Android keystore. Say yes and
  let EAS keep it. Losing a keystore matters only if you later publish.
- `appVersionSource: remote` means EAS tracks the version code, not this repo.

## 4. What to test on the phone

1. Add a task with a due date 2 minutes ahead and "Remind me" on. The
   **notification permission dialog appears only now**, not at launch.
2. Deny it. The banner explains and the task is still saved. Deny twice and the
   banner switches to "Open app settings" (Android stops showing the dialog).
3. Allow it. A second banner offers **Allow exact alarms**, which opens the
   system "Alarms & reminders" screen (Android 14+ denies this by default).
   Compare delivery time with and without it, with the screen off.
4. Settings > Display: set Font size and Display size to maximum. Nothing
   should clip or overlap. Toggle dark mode from the quick settings.
5. Swipe the app away, wait for the reminder, tap it.
6. Reboot the phone with a reminder pending; it should still fire
   (`RECEIVE_BOOT_COMPLETED`, added by expo-notifications).

## Android 16 / API 36

`app.json` sets `targetSdkVersion: 36` through `expo-build-properties`
(Expo SDK 58 already defaults to 36; it is pinned explicitly so it is visible
and cannot silently change). Verified in a generated `android/gradle.properties`
(`android.targetSdkVersion=36`). Consequences you will feel: edge-to-edge is
enforced (hence the safe-area insets in the code) and predictive back is on.

## Privacy / permissions

Declared by this app: `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, plus
`RECEIVE_BOOT_COMPLETED` (added by expo-notifications), `VIBRATE`.
`INTERNET`, `ACCESS_NETWORK_STATE` and `SYSTEM_ALERT_WINDOW` are REMOVED from
preview/production builds (`blockedPermissions` in `app.config.ts`) because the
app makes no network calls. Development builds keep them (Metro and the dev
menu need them): EAS sets `EAS_BUILD_PROFILE=development` itself; for a local
`expo run:android` dev build export `ALLOW_DEV_NETWORK=1` first, or the dev
client cannot reach Metro. Storage permissions are explicitly removed. The data
lives only in `todos.db` in the app's private storage.

`USE_EXACT_ALARM` is deliberately not declared: Google Play restricts it to
alarm-clock and calendar apps, and it would be the wrong one to learn.

## Not included on purpose

Navigation library / Expo Router (one screen + one modal does not need it),
state library (plain `useState` + SQLite), remote push, auth, backend, iOS
configuration, UI/component tests (only the pure notification logic is tested), Play Store assets.
