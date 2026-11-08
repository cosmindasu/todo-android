import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, TodoEditor } from './components/TodoEditor';
import { NameDialog, ProjectBar } from './components/ProjectBar';
import type { AttachmentPlan } from './components/TodoEditor';
import { ReminderBanner } from './components/ReminderBanner';
import { TodoItem } from './components/TodoItem';
import {
  deleteProject,
  getActiveProjectId,
  insertProject,
  listProjects,
  listTodoIdsInProject,
  renameProject,
  setActiveProjectId,
  type Project,
} from './db/projects';
import {
  allStoredNames,
  attachmentCounts,
  deleteAttachment,
  insertAttachment,
  listAttachments,
  type Attachment,
} from './db/attachments';
import { storedFileName } from './db/attachmentLimit';
import { deleteStored, storeAttachment, sweepStrays } from './files/attachmentStore';
import { applyTaskAction, type TaskAction } from './db/taskState';
import {
  insertTodo,
  listTodosInProject,
  setProgress,
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
  const [projects, setProjects] = useState<Project[]>([]);
  // null only until the first load finishes; `chooseActiveProject` guarantees
  // a real id afterwards as long as any project exists.
  const [activeId, setActiveId] = useState<number | null>(null);
  const [naming, setNaming] = useState<{ mode: 'add' } | { mode: 'rename'; project: Project } | null>(
    null,
  );
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [editingFiles, setEditingFiles] = useState<Attachment[]>([]);

  const loadProjects = useCallback(async () => {
    const [list, active] = await Promise.all([listProjects(db), getActiveProjectId(db)]);
    setProjects(list);
    setActiveId(active);
    return active;
  }, [db]);

  const reload = useCallback(async () => {
    const active = activeId ?? (await loadProjects());
    const [rows, byTodo] = await Promise.all([
      active === null ? Promise.resolve([]) : listTodosInProject(db, active),
      attachmentCounts(db),
    ]);
    setTodos(rows);
    setCounts(byTodo);
  }, [db, activeId, loadProjects]);

  /** Open the editor, with this task's files already loaded. */
  const openEditor = useCallback(
    async (todo: Todo | null) => {
      setEditing(todo);
      setEditingFiles(todo ? await listAttachments(db, todo.id).catch(() => []) : []);
      setEditorOpen(true);
    },
    [db],
  );

  /**
   * Carry out what the editor planned, now that the row certainly exists.
   *
   * Bytes are written BEFORE the row that points at them. The other order can
   * leave a row referring to a file that was never written — a broken
   * attachment — while this order can at worst leave a file nothing
   * references, which costs space and is swept up later.
   */
  const applyAttachmentPlan = useCallback(
    async (todoId: number, plan: AttachmentPlan) => {
      for (const id of plan.removeIds) {
        const storedAs = await deleteAttachment(db, id);
        if (storedAs) deleteStored(storedAs);
      }
      let seq = Date.now();
      for (const picked of plan.add) {
        const storedAs = storedFileName(seq++, picked.name);
        await storeAttachment(picked.uri, storedAs);
        await insertAttachment(db, todoId, {
          name: picked.name,
          size: picked.size,
          storedAs,
        });
      }
    },
    [db],
  );

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
    void loadProjects();
  }, [loadProjects]);

  // The same idea as reconciling alarms, for bytes: a crash between writing an
  // attachment and committing its row leaves a file nothing points at. Once at
  // startup, remove those.
  //
  // This DELETES files, so it runs only on a set we actually read. If the
  // query fails, `allStoredNames` throws and the sweep is skipped — passing an
  // empty set after a failed read would delete every attachment in the app.
  useEffect(() => {
    void (async () => {
      try {
        const known = await allStoredNames(db);
        sweepStrays(known);
      } catch {
        // Leaving a stray file costs space and nothing else.
      }
    })();
  }, [db]);

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

  async function handleSave(input: TodoInput, plan: AttachmentPlan) {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      let id = editing ? editing.id : insertedIdRef.current;
      if (id !== null) {
        await updateTodo(db, id, input);
      } else {
        if (activeId === null) throw new Error('No project is selected.');
        id = await insertTodo(db, activeId, input);
        insertedIdRef.current = id; // remember it in case a later step throws
      }

      await applyAttachmentPlan(id, plan);

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

  async function handleAction(todo: Todo, action: TaskAction) {
    try {
      await setProgress(db, todo.id, applyTaskAction(todo, action, Date.now()));
      await syncReminder(db, todo.id); // done => cancels; reopened => re-arms
    } catch (e) {
      Alert.alert('Could not update the task', String(e));
    } finally {
      await reload().catch(() => {}); // always show what the DB really says
    }
  }

  async function handleProjectName(name: string) {
    const current = naming;
    setNaming(null);
    if (!current) return;
    try {
      if (current.mode === 'add') {
        const id = await insertProject(db, name);
        await setActiveProjectId(db, id);
        setActiveId(id);
      } else {
        await renameProject(db, current.project.id, name);
      }
      await loadProjects();
    } catch (e) {
      Alert.alert('Could not save the project', String(e));
    }
  }

  function handleProjectLongPress(project: Project) {
    Alert.alert(project.name, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Rename', onPress: () => setNaming({ mode: 'rename', project }) },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteProject(project) },
    ]);
  }

  function confirmDeleteProject(project: Project) {
    if (projects.length <= 1) {
      Alert.alert('Keep one project', 'A task has to live somewhere, so the last project stays.');
      return;
    }
    Alert.alert(
      `Delete "${project.name}"?`,
      'Its tasks and their reminders are deleted too. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Each task goes through the reminder path, never straight out of
              // SQLite: a row deleted behind the alarm's back leaves an OS
              // alarm that nothing owns and nothing can cancel.
              for (const id of await listTodoIdsInProject(db, project.id)) {
                await deleteTaskAndReminder(db, id);
              }
              await deleteProject(db, project.id);
              const remaining = await listProjects(db);
              const next = remaining[0];
              if (next) {
                await setActiveProjectId(db, next.id);
                setActiveId(next.id);
              }
              await loadProjects();
            } catch (e) {
              Alert.alert('Could not delete the project', String(e));
            } finally {
              await reload().catch(() => {});
            }
          },
        },
      ],
    );
  }

  async function handleSelectProject(id: number) {
    setActiveId(id);
    try {
      await setActiveProjectId(db, id);
    } catch {
      // Remembering the choice is a convenience; failing to store it must not
      // stop the user from switching.
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

      <ProjectBar
        projects={projects}
        activeId={activeId}
        onSelect={(id) => void handleSelectProject(id)}
        onAdd={() => setNaming({ mode: 'add' })}
        onLongPress={handleProjectLongPress}
      />

      {caps ? <ReminderBanner caps={caps} onChanged={refresh} /> : null}

      <FlatList
        data={todos}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TodoItem
            todo={item}
            onAction={handleAction}
            attachmentCount={counts.get(item.id) ?? 0}
            onEdit={(todo) => void openEditor(todo)}
            onDelete={handleDelete}
          />
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.textMuted }]}>
            No tasks in this project yet. Add one below.
          </Text>
        }
        contentContainerStyle={{ paddingBottom: 16 }}
        style={{ flex: 1 }}
      />

      <View style={{ padding: 16, paddingBottom: 16 + insets.bottom, alignItems: 'flex-start' }}>
        <Button
          label="Add task"
          primary
          onPress={() => {
            insertedIdRef.current = null;
            void openEditor(null);
          }}
        />
      </View>

      <TodoEditor
        visible={editorOpen}
        todo={editing}
        attachments={editingFiles}
        onCancel={() => {
          insertedIdRef.current = null;
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <NameDialog
        visible={naming !== null}
        title={naming?.mode === 'rename' ? 'Rename project' : 'New project'}
        initial={naming?.mode === 'rename' ? naming.project.name : ''}
        confirmLabel={naming?.mode === 'rename' ? 'Rename' : 'Create'}
        onCancel={() => setNaming(null)}
        onConfirm={(name) => void handleProjectName(name)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', lineHeight: 36, paddingHorizontal: 16, paddingVertical: 12 },
  empty: { textAlign: 'center', fontSize: 16, lineHeight: 24, padding: 32 },
});
