import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Todo } from '../db/todos';
import { MIN_TOUCH, useTheme } from '../theme/colors';

export function formatDue(ms: number): string {
  // Intl-backed, follows the device locale and 12/24h setting.
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface Props {
  todo: Todo;
  onToggle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

/**
 * Layout rules for font scaling: no fixed heights anywhere (only minHeight),
 * text wraps instead of truncating, and the row can grow to any size. Test at
 * Settings > Display > Font size = largest, plus "Display size" = largest.
 */
export function TodoItem({ todo, onToggle, onEdit, onDelete }: Props) {
  const t = useTheme();
  const overdue = !todo.done && todo.dueAt !== null && todo.dueAt < Date.now();
  const dueText = todo.dueAt !== null ? formatDue(todo.dueAt) : null;

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

  return (
    <View style={[styles.row, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: todo.done }}
        accessibilityLabel={todo.title}
        accessibilityHint={todo.done ? 'Mark as not done' : 'Mark as done'}
        onPress={() => onToggle(todo)}
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
        accessibilityLabel={`Edit ${todo.title}`}
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
        {dueText ? (
          <Text style={[styles.due, { color: overdue ? t.danger : t.textMuted }]}>
            {overdue ? 'Overdue · ' : ''}
            {dueText}
            {reminderLabel}
          </Text>
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
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 4,
    minHeight: MIN_TOUCH,
  },
  check: { width: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { fontSize: 16, fontWeight: '700', lineHeight: 20 },
  body: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', paddingVertical: 8 },
  title: { fontSize: 17, lineHeight: 24 },
  strike: { textDecorationLine: 'line-through' },
  due: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  delete: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 12 },
  deleteText: { fontSize: 14, fontWeight: '600' },
});
