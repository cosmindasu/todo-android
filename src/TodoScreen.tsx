import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, TodoEditor } from './components/TodoEditor';
import { ReminderBanner } from './components/ReminderBanner';
import { TodoItem } from './components/TodoItem';
import {
  insertTodo,
  listTodos,
  setDone,
  updateTodo,
  type Todo,
  type TodoInput,
} from './db/todos';
import {
  deleteTaskAndReminder,
  reconcileReminders,
  requestNotificationPermission,
  syncReminder,
} from './notifications/reminders';
import { useReminderCapabilities } from './notifications/useReminderCapabilities';
import { useTheme } from './theme/colors';

export function TodoScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { caps, refresh } = useReminderCapabilities();

  const [todos, setTodos] = useState<Todo[]>([]);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const reload = useCallback(async () => {
    setTodos(await listTodos(db));
  }, [db]);

  // Make the OS alarms match the database, then refresh the list: reconcile
  // writes fresh notification_ids to SQLite, and without this reload the screen
  // would keep showing the old (often null) ones.
  const reconcileAndReload = useCallback(async () => {
    try {
      await reconcileReminders(db);
    } catch (e) {
      console.warn('reconcile failed', e);
    }
    await reload();
  }, [db, reload]);

  // Reconcile is NOT a one-off. The OS can change under a running or sleeping
  // app, so we re-run it (1) at startup, (2) every time the app returns to the
  // foreground, and (3) when a permission flips (effect below).
  useEffect(() => {
    void reload();
    void reconcileAndReload();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reconcileAndReload();
    });
    return () => sub.remove();
  }, [reload, reconcileAndReload]);

  // Permission flips (banner buttons, or the user coming back from system
  // settings) change `caps`. Depend on the primitive values, not the object,
  // which is a new object after every refresh.
  const notificationState = caps?.notifications ?? null;
  const exactState = caps?.exactAlarms ?? null;
  const firstCaps = useRef(true);
  useEffect(() => {
    if (notificationState === null) return;
    if (firstCaps.current) {
      firstCaps.current = false; // the startup effect already reconciled
      return;
    }
    void reconcileAndReload();
  }, [notificationState, exactState, reconcileAndReload]);

  // Re-entrancy guard. A ref (not state) because it must change SYNCHRONOUSLY:
  // state updates are applied on the next render, so two fast taps could both
  // still see `false`.
  const savingRef = useRef(false);
  // Row inserted by an attempt that then failed. A retry must UPDATE this row,
  // not insert a second copy.
  const insertedIdRef = useRef<number | null>(null);

  async function handleSave(input: TodoInput) {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      let id = editing ? editing.id : insertedIdRef.current;
      if (id !== null) {
        await updateTodo(db, id, input);
      } else {
        id = await insertTodo(db, input);
        insertedIdRef.current = id; // remember it in case a later step throws
      }

      if (input.remind) {
        // Ask for permission here, at the moment the user asks for a reminder,
        // when the reason for the prompt is obvious - not at app launch.
        await requestNotificationPermission();
      }
      const outcome = await syncReminder(db, id);
      if (!outcome.scheduled && outcome.reason === 'no-permission') {
        Alert.alert(
          'Reminder not scheduled',
          'The task was saved, but notifications are not allowed, so no reminder will fire.',
        );
      }
      insertedIdRef.current = null;
      setEditorOpen(false);
      setEditing(null);
      await reload();
      await refresh();
    } catch (e) {
      // The row may already be committed; show it in the list behind the editor.
      await reload().catch(() => {});
      Alert.alert('Could not save', String(e));
    } finally {
      savingRef.current = false;
    }
  }

  async function handleToggle(todo: Todo) {
    try {
      await setDone(db, todo.id, !todo.done);
      await syncReminder(db, todo.id); // done => cancels; un-done => re-arms
    } catch (e) {
      Alert.alert('Could not update the task', String(e));
    } finally {
      await reload().catch(() => {}); // always show what the DB really says
    }
  }

  function handleDelete(todo: Todo) {
    Alert.alert('Delete task?', todo.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTaskAndReminder(db, todo.id);
          } catch (e) {
            Alert.alert('Could not delete the task', String(e));
          } finally {
            await reload().catch(() => {});
          }
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.background, paddingTop: insets.top }}>
      <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>
        Tasks
      </Text>

      {caps ? <ReminderBanner caps={caps} onChanged={refresh} /> : null}

      <FlatList
        data={todos}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TodoItem
            todo={item}
            onToggle={handleToggle}
            onEdit={(todo) => {
              setEditing(todo);
              setEditorOpen(true);
            }}
            onDelete={handleDelete}
          />
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.textMuted }]}>No tasks yet. Add one below.</Text>
        }
        contentContainerStyle={{ paddingBottom: 16 }}
        style={{ flex: 1 }}
      />

      <View style={{ padding: 16, paddingBottom: 16 + insets.bottom, alignItems: 'flex-start' }}>
        <Button
          label="Add task"
          primary
          onPress={() => {
            setEditing(null);
            insertedIdRef.current = null;
            setEditorOpen(true);
          }}
        />
      </View>

      <TodoEditor
        visible={editorOpen}
        todo={editing}
        onCancel={() => {
          insertedIdRef.current = null;
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', lineHeight: 36, paddingHorizontal: 16, paddingVertical: 12 },
  empty: { textAlign: 'center', fontSize: 16, lineHeight: 24, padding: 32 },
});
