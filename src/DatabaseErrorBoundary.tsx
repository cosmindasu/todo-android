import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useTheme } from './theme/colors';

/**
 * React's equivalent of a global `try/catch` around rendering. If anything
 * below throws while rendering (here: the SQLite migration in `onInit`), React
 * unmounts the whole tree - a white screen / crash in a release build -
 * UNLESS an error boundary above it catches the error and renders a fallback.
 *
 * Why a class? Error boundaries are the one React feature that still has no
 * hook equivalent: only class components can implement getDerivedStateFromError.
 *
 * `<Suspense>` is NOT a substitute: it only handles components that are still
 * LOADING (a thrown promise), never ones that FAILED (a thrown error).
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class DatabaseErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Startup error caught by DatabaseErrorBoundary', error, info.componentStack);
  }

  render() {
    if (this.state.error) return <ErrorScreen error={this.state.error} />;
    return this.props.children;
  }
}

function ErrorScreen({ error }: { error: Error }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.background, justifyContent: 'center', padding: 24 }}>
      <ScrollView contentContainerStyle={{ gap: 12, flexGrow: 1, justifyContent: 'center' }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 24, fontWeight: '700', lineHeight: 32 }}>
          The app could not open your tasks
        </Text>
        <Text style={{ color: t.text, fontSize: 16, lineHeight: 24 }}>
          Your data has not been changed. Closing the app completely and opening it again may help; if the
          message below mentions a newer version, update the app.
        </Text>
        <Text selectable style={{ color: t.danger, fontSize: 15, lineHeight: 22 }}>
          {error.message}
        </Text>
      </ScrollView>
    </View>
  );
}
