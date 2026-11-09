# Android Todo (Expo + TypeScript)

A todo app small enough to read in an afternoon, written to get the
Android-specific parts right rather than to be large. Projects, tasks with
notes, three states (not started / in progress / done), an optional due date
with a local reminder, and up to three attached files per task.

The interesting part is not the todo list. It is everything Android puts
between "the code schedules a reminder" and "the reminder appears": three
independent permission gates, alarms that are exact only if you ask, a schema
that has to survive upgrades on real data, and files that arrive as a borrowed
URI rather than as bytes. Each of those is handled explicitly here, and the
claims below were checked on a device rather than reasoned about.

No backend, no accounts, no analytics, and it is not published on Google Play.

## What was checked on a device, and what that found

Every number in this README was measured on an Android 16 (API 36) emulator.
Five problems came out of doing that rather than reading the code — four in the
app, one in this README — and all five are the kind that look fine until you
look:

| Checked | What it found |
| --- | --- |
| The three notification gates, one at a time | All behave as designed: no permission dialog at launch, the prompt appears at the moment a reminder is asked for, and a denial leaves the task saved with the reason stated rather than failing silently |
| `dumpsys alarm`, with and without `SCHEDULE_EXACT_ALARM` | Without it the alarm carries a **16.5-second window**; with it, `window=0` and `exactAllowReason=permission`. The "exact alarms" switch is not cosmetic |
| Upgrading a **real v3 database**, not a fresh install | The v4-v6 migrations preserved both existing tasks, their due dates and their reminder state, and moved them into the default project |
| Reading the attached bytes back off the device | A row said `ui.xml · 25459` while the file was **11359 bytes**: the picker reports a size from a DocumentsProvider that can be stale. The size now comes from the bytes actually written |
| What the file picker calls a file | `edge-420.jpg` arrived as **`image:26`**. A `File` built from a `content://` URI takes its name from the URI; only a ContentResolver query knows the real one |
| The permissions in the built APK | The README used to list 4. The APK declares **24** — see [Privacy / permissions](#privacy--permissions) |
| The screen itself, not the layout code | A `ScrollView` grows on its cross axis (a band of empty space above the list), and a `Modal` does not inherit the activity's `adjustResize` (a dialog behind the keyboard) |

The pure logic — the reminder reconcile plan, the per-task lock, the task state
machine, the attachment rules — is tested with `node --test` and no framework:
41 tests, under a second, run on every push.

Stack: Expo SDK 58, React Native 0.88, React 19, TypeScript (strict),
`expo-sqlite`, `expo-notifications`, `@react-native-community/datetimepicker`,
`react-native-safe-area-context`, `expo-dev-client`, `expo-build-properties`,
`expo-file-system` and `expo-document-picker` (attachments).

## Where to read first

| File | What it teaches |
| --- | --- |
| `src/notifications/reminders.ts` | Channel, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM: why each exists, what breaks without it |
| `src/db/database.ts` | Migration runner using `PRAGMA user_version`, and six real migrations — including the SQLite rules behind the order of v5, and the one that turned out not to be a rule |
| `src/db/taskState.ts` | The three task states as pure data, with the invariants as tests |
| `src/db/attachmentLimit.ts` | Why a picked file's own name must never become a path |
| `src/files/attachmentStore.ts` | Why the bytes are copied instead of keeping the `content://` URI |
| `src/db/todos.ts` | Parameterised queries, 0/1 booleans, row <-> object mapping |
| `src/components/ReminderBanner.tsx` | Graceful denied / blocked / no-exact-alarm states |
| `src/components/TodoEditor.tsx` | Imperative Android date/time dialogs, safe-area insets |
| `src/theme/colors.ts` | Dark mode palettes (AA contrast), 48dp touch targets |
| `app.config.ts` | Permissions, target SDK 36, plugins, network lock-down in release builds |
| `src/notifications/keyedMutex.ts`, `reconcilePlan.ts` | Pure logic (per-task lock, OS-vs-DB reconcile plan) with tests: `npm test` |
| `src/components/ProjectBar.tsx` | Two React Native traps, both found by looking at the screen: a `ScrollView` grows on the cross axis, and a `Modal` does not get the activity's `adjustResize` |

## The data model

A task belongs to exactly one **project**, has optional **notes**, moves through
**three states** (not started -> in progress -> done, recording when each began)
and can carry up to **three files**.

That shape is not invented: it is the model of the task list this project's
author actually uses day to day, which had projects, notes and an in-progress
flag and had never needed a due date. The reminder machinery stays anyway,
because the Android lessons are the point of the app — but the rest of the
model now matches how the work really goes.

Three decisions worth the words:

- **Attachments are copied, not referenced.** The system picker returns a
  `content://` URI, which is a *grant*, not a path: it expires, and the file
  behind it can be moved or deleted by the app that owns it. A todo list that
  showed an attachment yesterday and cannot open it today is worse than one
  with no attachments, so the bytes are copied into the app's own storage. The
  copy is read-then-write rather than a filesystem copy, because a filesystem
  copy cannot follow a `content://` URI — which is also why there is a size
  ceiling (`MAX_ATTACHMENT_BYTES`): the file passes through memory.
- **The picked file's name is never a path.** It is untrusted text that can
  contain `/`, `..` or a NUL. The stored name is generated by the app and only
  a conservative extension is taken from the original; the original is kept for
  display only. `storedFileName` is tested against the nasty cases.
- **Picking goes through `expo-document-picker`, not `expo-file-system`.**
  `File.pickFileAsync` is in the SDK and would have saved a dependency, but the
  system picker returns a `content://media/...` URI and a `File` built from it
  takes its name from the URI's last path segment. Measured on a device: a file
  called `edge-420.jpg` came back as **`image:26`**. Only a ContentResolver
  query knows the display name, and `expo-document-picker` does that natively.
  An attachment the user cannot recognise by name is barely an attachment.
- **Foreign keys are on, and they are the guard.** Deleting a project that
  still owns tasks, or a task that still owns files, fails loudly instead of
  orphaning rows whose reminders and bytes nothing would ever clean up. The
  code deletes them in the right order; the constraint is what makes forgetting
  impossible rather than merely unlikely.

### What v5 teaches about SQLite

The projects migration is four statements and three of them are forced:

- the default project must EXIST before a column that defaults to it;
- `created_at` cannot come from JavaScript, because a migration is a fixed
  string with no bound parameters — SQLite computes it with `strftime`;
- `ADD COLUMN` may be `NOT NULL` only with a *constant* default, which is why
  the default project has the hard-coded id 1.

A fourth rule used to be listed here: that `ADD COLUMN ... REFERENCES` is only
legal while foreign-key enforcement is off, and that `PRAGMA foreign_keys = ON`
therefore had to run after the migrations. **Measured, that is false** — on
SQLite 3.51.2 the whole chain runs identically either way, with no violations,
and `database.test.ts` asserts it. The pragma still runs afterwards, because a
future migration that adds a column and then backfills it would be checked
mid-flight otherwise, but that is prudence rather than a requirement. It is
left in the record because a confident mechanism written into a teaching
project and then disproved by its own test is worth more than a tidy list.

Verified by upgrading a real v3 database on a device rather than a fresh
install: two existing tasks kept their titles, due dates and reminder state,
landed in the default project, and came out with the new columns at their
defaults. Rows completed before v4 keep `done_at = NULL`, because the migration
had nothing honest to put there, and the UI says "done" without a time.

## 1. Install

Requires Node 20+ (tested with Node 22, npm 10).

```bash
cd todo-android          # wherever you cloned it
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

`app.config.ts` sets `targetSdkVersion: 36` through `expo-build-properties`
(Expo SDK 58 already defaults to 36; it is pinned explicitly so it is visible
and cannot silently change). Verified in a generated `android/gradle.properties`
(`android.targetSdkVersion=36`). Consequences you will feel: edge-to-edge is
enforced (hence the safe-area insets in the code) and predictive back is on.

## Privacy / permissions
<a id="privacy--permissions"></a>

This section used to list four permissions. The built APK declares **24**. The
list below is read out of the APK, not out of `app.config.ts`, because those
are different things: a library's manifest is merged into yours, and nothing
asks you first.

**Asked for on purpose** (`app.config.ts`, plus the prebuild template):

| Permission | Why |
| --- | --- |
| `POST_NOTIFICATIONS` | the runtime permission for reminders (Android 13+) |
| `SCHEDULE_EXACT_ALARM` | so a reminder arrives at the minute (Android 12+) |
| `VIBRATE` | added by the Expo template; the reminder channel uses it |

**Arrived with the libraries**, every one of them through `expo-notifications`
and its transitive dependencies:

| Permission(s) | Comes from |
| --- | --- |
| `RECEIVE_BOOT_COMPLETED` | `expo-notifications`, to re-arm alarms after a reboot |
| `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` | Firebase Cloud Messaging, which `expo-notifications` links in even though this app sends no remote push |
| `com.android.installreferrer...BIND_GET_INSTALL_REFERRER_SERVICE` | the Play Install Referrer library, pulled in the same way |
| 16 OEM badge permissions (`com.sec...`, `com.huawei...`, `com.oppo...`, `me.everything...`, `READ_APP_BADGE`, ...) | `me.leolin:ShortcutBadger:1.1.22`, an explicit dependency in `expo-notifications/android/build.gradle`, so unread-count badges work on OEM launchers |
| `...DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | `androidx.core`; a self-scoped permission that guards the app's own runtime receivers |

Worth noticing: the app asks to receive Firebase messages while having no
`INTERNET` permission at all. Neither half is wrong on its own, and together
they are harmless, but it is a fair illustration of how little the manifest you
wrote has to do with the manifest you ship.

**Removed on purpose.** `INTERNET`, `ACCESS_NETWORK_STATE`, `SYSTEM_ALERT_WINDOW`
and both external-storage permissions are listed in `blockedPermissions` and
appear in the generated manifest as `tools:node="remove"`; they are absent from
the final APK (checked, not assumed). The block beats a library that asks for
the same thing, which is the part worth knowing — the merger report says so in
as many words:

```
uses-permission#android.permission.ACCESS_NETWORK_STATE
  ADDED from .../app/src/main/AndroidManifest.xml
  REJECTED from [com.google.firebase:firebase-messaging:25.0.1]
  REJECTED from [com.google.firebase:firebase-installations:18.0.0]
```
 The app makes no network calls, and task
data and attachments live only in its private storage. Development builds keep
the network ones, because Metro and the dev menu need them: EAS sets
`EAS_BUILD_PROFILE=development` itself, and for a local `expo run:android` dev
build export `ALLOW_DEV_NETWORK=1` first or the dev client cannot reach Metro.

The badge, Firebase and install-referrer permissions could be stripped the same
way, since nothing here uses them. They are left in deliberately: removing them
would hide the lesson, which is that **the only honest source for this list is
the APK**. Read yours with:

```bash
aapt2 dump permissions android/app/build/outputs/apk/release/app-release.apk | grep uses-permission
```

and attribute each one with the merger report Gradle already wrote:

```bash
grep -B 1 -A 3 "^uses-permission#" android/app/build/outputs/logs/manifest-merger-release-report.txt
```

`USE_EXACT_ALARM` is deliberately not declared: Google Play restricts it to
alarm-clock and calendar apps, and it would be the wrong one to learn.

## Not included on purpose

Navigation library / Expo Router (one screen + one modal does not need it),
state library (plain `useState` + SQLite), remote push, auth, backend, iOS
configuration, UI/component tests (only the pure notification logic is tested), Play Store assets.
