import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Todo } from '../db/todos';
import { taskStateLabel, type TaskAction } from '../db/taskState';
import { MIN_TOUCH, useTheme } from '../theme/colors';

export function formatDue(ms: number): string {
  // Intl-backed, follows the device locale and 12/24h setting.
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Shorter form for the start/finish stamps, which are context, not the point. */
export function formatStamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

interface Props {
  todo: Todo;
  /** How many files are attached; shown as a count, not as a list. */
  attachmentCount: number;
  onAction: (todo: Todo, action: TaskAction) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

/**
 * Layout rules for font scaling: no fixed heights anywhere (only minHeight),
 * text wraps instead of truncating, and the row can grow to any size. Test at
 * Settings > Display > Font size = largest, plus "Display size" = largest.
 *
 * The task has three states, so the row carries two controls: the checkbox
 * completes or reopens, and a second button starts or pauses the work. They
 * are on separate lines rather than squeezed into one row, because at the
 * largest font size four columns do not fit on a phone.
 */
export function TodoItem({ todo, attachmentCount, onAction, onEdit, onDelete }: Props) {
  const t = useTheme();
  const overdue = !todo.done && todo.dueAt !== null && todo.dueAt < Date.now();
  const dueText = todo.dueAt !== null ? formatDue(todo.dueAt) : null;
  const state = taskStateLabel(todo);

  // The bell shows what is TRUE, not what was asked for: `remind` is the user's
  // intent, `notificationId` exists only if an OS alarm was actually scheduled
  // (and reconcile keeps it honest). Words are included so the state is not
  // conveyed by an emoji alone.
  let reminderLabel = '';
  if (todo.remind && !todo.done) {
    if (todo.reminderMissed) reminderLabel = ' · Reminder may have been missed';
    else if (todo.notificationId !== null) reminderLabel = ' · 🔔 Reminder set';
    else if (!overdue) reminderLabel = ' · 🔕 Reminder not scheduled';
  }

  // "Done" with no timestamp is normal: rows completed before the column
  // existed have nothing honest to show, and the migration did not invent one.
  const stamps: string[] = [];
  if (attachmentCount > 0) {
    stamps.push(`${attachmentCount} file${attachmentCount === 1 ? '' : 's'}`);
  }
  if (todo.startedAt !== null) stamps.push(`Started ${formatStamp(todo.startedAt)}`);
  if (todo.done && todo.doneAt !== null) stamps.push(`Done ${formatStamp(todo.doneAt)}`);

  return (
    <View style={[styles.row, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.top}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: todo.done }}
          accessibilityLabel={todo.title}
          accessibilityHint={todo.done ? 'Mark as not done' : 'Mark as done'}
          onPress={() => onAction(todo, todo.done ? 'reopen' : 'complete')}
          style={styles.check}
        >
          <View
            style={[
              styles.box,
              { borderColor: t.accent, backgroundColor: todo.done ? t.accent : 'transparent' },
            ]}
          >
            {todo.done ? <Text style={[styles.tick, { color: t.onAccent }]}>✓</Text> : null}
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            attachmentCount > 0
              ? `Edit ${todo.title}, ${state}, ${attachmentCount} file${attachmentCount === 1 ? '' : 's'} attached`
              : `Edit ${todo.title}, ${state}`
          }
          onPress={() => onEdit(todo)}
          style={styles.body}
        >
          <Text
            style={[
              styles.title,
              { color: todo.done ? t.textMuted : t.text },
              todo.done && styles.strike,
            ]}
          >
            {todo.title}
          </Text>
          {todo.description.length > 0 ? (
            <Text style={[styles.notes, { color: t.textMuted }]}>{todo.description}</Text>
          ) : null}
          {todo.inProgress ? (
            <Text style={[styles.state, { color: t.accent }]}>In progress</Text>
          ) : null}
          {dueText ? (
            <Text style={[styles.due, { color: overdue ? t.danger : t.textMuted }]}>
              {overdue ? 'Overdue · ' : ''}
              {dueText}
              {reminderLabel}
            </Text>
          ) : null}
          {stamps.length > 0 ? (
            <Text style={[styles.due, { color: t.textMuted }]}>{stamps.join(' · ')}</Text>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${todo.title}`}
          onPress={() => onDelete(todo)}
          style={styles.delete}
        >
          <Text style={[styles.deleteText, { color: t.danger }]}>Delete</Text>
        </Pressable>
      </View>

      {!todo.done ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              todo.inProgress ? `Pause ${todo.title}` : `Start working on ${todo.title}`
            }
            onPress={() => onAction(todo, todo.inProgress ? 'pause' : 'start')}
            style={({ pressed }) => [
              styles.action,
              { borderColor: t.border, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.actionText, { color: t.text }]}>
              {todo.inProgress ? 'Pause' : 'Start'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  top: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  check: { width: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { fontSize: 16, fontWeight: '700', lineHeight: 20 },
  body: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', paddingVertical: 8 },
  title: { fontSize: 17, lineHeight: 24 },
  strike: { textDecorationLine: 'line-through' },
  notes: { fontSize: 15, lineHeight: 22, marginTop: 2 },
  state: { fontSize: 14, lineHeight: 20, marginTop: 2, fontWeight: '700' },
  due: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  delete: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 12 },
  deleteText: { fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  action: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderWidth: 1,
    borderRadius: MIN_TOUCH / 2,
  },
  actionText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
});
