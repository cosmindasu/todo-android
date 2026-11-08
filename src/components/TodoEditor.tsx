import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Todo, TodoInput } from '../db/todos';
import { MIN_TOUCH, useTheme } from '../theme/colors';
import { formatDue } from './TodoItem';

interface Props {
  visible: boolean;
  /** null = creating a new task. */
  todo: Todo | null;
  onCancel: () => void;
  onSave: (input: TodoInput) => void;
}

export function TodoEditor({ visible, todo, onCancel, onSave }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState<number | null>(null);
  const [remind, setRemind] = useState(false);

  // Reset the form each time the modal opens for a different task.
  useEffect(() => {
    if (visible) {
      setTitle(todo?.title ?? '');
      setDueAt(todo?.dueAt ?? null);
      setRemind(todo?.remind ?? false);
    }
  }, [visible, todo]);

  // The Android picker is an imperative native dialog (not a component). Date
  // and time are two separate dialogs, chained here.
  function pickDueDate() {
    const start = new Date(dueAt ?? Date.now() + 60 * 60 * 1000);
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      onValueChange: (_e, pickedDate) => {
        DateTimePickerAndroid.open({
          value: start,
          mode: 'time',
          onValueChange: (_e2, pickedTime) => {
            const merged = new Date(pickedDate);
            merged.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
            setDueAt(merged.getTime());
          },
        });
      },
    });
  }

  const canSave = title.trim().length > 0;
  const inPast = dueAt !== null && dueAt <= Date.now();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: t.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Edge-to-edge is mandatory on Android 15+: content draws under the
            status and navigation bars unless we pad by the insets ourselves. */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 16,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
            gap: 16,
          }}
        >
          <Text accessibilityRole="header" style={[styles.heading, { color: t.text }]}>
            {todo ? 'Edit task' : 'New task'}
          </Text>

          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: t.text }]} nativeID="title-label">
              Title
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              autoFocus
              multiline
              accessibilityLabelledBy="title-label"
              placeholder="What needs doing?"
              placeholderTextColor={t.textMuted}
              style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: t.text }]}>Due</Text>
            <Text style={{ color: t.textMuted, fontSize: 15, lineHeight: 22 }}>
              {dueAt !== null ? formatDue(dueAt) : 'No due date'}
            </Text>
            <View style={styles.rowWrap}>
              <Button label={dueAt !== null ? 'Change date and time' : 'Set date and time'} onPress={pickDueDate} />
              {dueAt !== null ? (
                <Button
                  label="Clear"
                  onPress={() => {
                    setDueAt(null);
                    setRemind(false);
                  }}
                />
              ) : null}
            </View>
          </View>

          {dueAt !== null ? (
            <View style={styles.switchRow}>
              <Text style={[styles.label, { color: t.text, flex: 1 }]} nativeID="remind-label">
                Remind me at the due time
              </Text>
              <Switch
                value={remind}
                onValueChange={setRemind}
                accessibilityLabelledBy="remind-label"
                trackColor={{ true: t.accent, false: t.border }}
              />
            </View>
          ) : null}
          {remind && inPast ? (
            <Text style={{ color: t.danger, fontSize: 15, lineHeight: 22 }}>
              That time has already passed, so no reminder will be scheduled.
            </Text>
          ) : null}

          <View style={styles.rowWrap}>
            <Button label="Cancel" onPress={onCancel} />
            <Button
              label="Save"
              primary
              disabled={!canSave}
              onPress={() => onSave({ title: title.trim(), dueAt, remind: remind && dueAt !== null })}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Button({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? t.accent : 'transparent',
          borderColor: primary ? t.accent : t.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? t.onAccent : t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  label: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: MIN_TOUCH,
    fontSize: 17,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH },
  button: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
