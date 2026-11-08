import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DATABASE_NAME, migrateDbIfNeeded } from './src/db/database';
import { DatabaseErrorBoundary } from './src/DatabaseErrorBoundary';
import { TodoScreen } from './src/TodoScreen';
import { configureForegroundBehaviour } from './src/notifications/reminders';
import { useTheme } from './src/theme/colors';

// Module scope on purpose: must be registered before any notification can arrive.
configureForegroundBehaviour();

function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
      <ActivityIndicator accessibilityLabel="Opening database" />
      <Text style={{ color: t.textMuted, marginTop: 12 }}>Opening database…</Text>
    </View>
  );
}

export default function App() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      {/* 'auto' follows the system theme: light icons on dark, dark icons on light. */}
      <StatusBar style={t.isDark ? 'light' : 'dark'} />
      {/* onInit runs the migrations; children render only after it resolves.
          Two different mechanisms, two different jobs:
            - <Suspense> shows <Loading/> while onInit is still RUNNING.
            - <DatabaseErrorBoundary> shows the error if onInit FAILED (with
              useSuspense the rejection is re-thrown during render; Suspense does
              not catch errors, so without the boundary a release build crashes).
          The boundary sits OUTSIDE Suspense so it catches whatever Suspense lets through. */}
      <DatabaseErrorBoundary>
        <Suspense fallback={<Loading />}>
          <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded} useSuspense>
            <TodoScreen />
          </SQLiteProvider>
        </Suspense>
      </DatabaseErrorBoundary>
    </SafeAreaProvider>
  );
}
