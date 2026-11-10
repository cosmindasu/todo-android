import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState } from 'react';
import {
  Alert,
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

import type { Attachment } from '../db/attachments';
import {
  acceptAttachments,
  formatSize,
  tooLargeMessage,
  MAX_ATTACHMENTS,
} from '../db/attachmentLimit';
import type { Todo, TodoInput } from '../db/todos';
import { MIN_TOUCH, useTheme } from '../theme/colors';
import { formatDue } from './TodoItem';

/** A file the user picked but that is not stored yet: the task may not exist. */
export interface PickedFile {
  uri: string;
  /** The file's REAL name, as the system reports it. See `pickFiles`. */
  name: string;
  size: number;
}

/** What the editor wants done to this task's files when it is saved. */
export interface AttachmentPlan {
  removeIds: number[];
  add: PickedFile[];
}

interface Props {
  visible: boolean;
  /** null = creating a new task. */
  todo: Todo | null;
  /** Files already stored for `todo`; empty for a new task. */
  attachments: readonly Attachment[];
  onCancel: () => void;
  onSave: (input: TodoInput, plan: AttachmentPlan) => void;
}

export function TodoEditor({ visible, todo, attachments, onCancel, onSave }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState<number | null>(null);
  const [remind, setRemind] = useState(false);
  // Files cannot be stored while the editor is open: a new task has no id yet,
  // and a cancelled edit must leave nothing behind. So the editor only keeps a
  // PLAN, and the screen carries it out after the row is saved.
  const [removed, setRemoved] = useState<number[]>([]);
  const [pending, setPending] = useState<PickedFile[]>([]);

  // Reset the form each time the modal opens for a different task.
  useEffect(() => {
    if (visible) {
      setTitle(todo?.title ?? '');
      setDescription(todo?.description ?? '');
      setDueAt(todo?.dueAt ?? null);
      setRemind(todo?.remind ?? false);
      setRemoved([]);
      setPending([]);
    }
  }, [visible, todo]);

  const kept = attachments.filter((a) => !removed.includes(a.id));
  const fileCount = kept.length + pending.length;

  /**
   * `expo-document-picker` rather than `expo-file-system`'s own
   * `File.pickFileAsync`, for one reason: the NAME.
   *
   * The system picker returns a `content://media/...` URI, and a File built
   * from it derives its name from the URI's last path segment — "image:26",
   * not "edge-420.jpg". Measured on a device, not guessed. Only a
   * ContentResolver query knows the display name, and the document picker
   * does that natively. An attachment the user cannot recognise by name is
   * not much of an attachment.
   */
  async function pickFiles() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const refusals: string[] = [];
      const usable: PickedFile[] = [];
      for (const asset of res.assets) {
        const name = asset.name || 'file';
        const size = asset.size ?? 0;
        const tooBig = tooLargeMessage(name, asset.size ?? null);
        if (tooBig) refusals.push(tooBig);
        else usable.push({ uri: asset.uri, name, size });
      }
      const decision = acceptAttachments(fileCount, usable.length);
      if (decision.message) refusals.push(decision.message);
      if (decision.accepted > 0) setPending((cur) => [...cur, ...usable.slice(0, decision.accepted)]);
      if (refusals.length > 0) Alert.alert('Not everything could be attached', refusals.join('\n\n'));
    } catch (e) {
      Alert.alert('Could not open the file picker', String(e));
    }
  }

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
            status and navigation bars unless we pad by the insets ourselves.

            The inset below is on contentContainerStyle, so it is CONTENT, not a
            fixed margin: it puts the heading below the status bar at rest, and
            then scrolls away with everything else. On a form short enough to
            fit that is invisible; once it scrolls - a due date, a reminder and
            three files is enough - the heading slides under the translucent
            status bar and collides with the clock. Measured on the phone.

            Keeping the padding is right, because the content should start below
            the bar. What was missing is the band further down, which hides
            whatever scrolls up there. */}
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
            <Text style={[styles.label, { color: t.text }]} nativeID="notes-label">
              Notes
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Anything the title does not say"
              placeholderTextColor={t.textMuted}
              multiline
              // No fixed height: the box grows with the text and with the
              // system font scale, like everything else on this screen.
              style={[
                styles.input,
                styles.notes,
                { color: t.text, borderColor: t.border, backgroundColor: t.surface },
              ]}
              accessibilityLabelledBy="notes-label"
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

          <View style={{ gap: 8 }}>
            <Text style={[styles.label, { color: t.text }]}>
              {`Files (${fileCount} of ${MAX_ATTACHMENTS})`}
            </Text>
            {fileCount === 0 ? (
              <Text style={{ color: t.textMuted, fontSize: 15, lineHeight: 22 }}>
                No files attached.
              </Text>
            ) : null}
            {kept.map((a) => (
              <View key={`a${a.id}`} style={styles.fileRow}>
                <Text style={[styles.fileName, { color: t.text }]}>
                  {`${a.name} · ${formatSize(a.size)}`}
                </Text>
                <Button
                  label="Remove"
                  onPress={() => setRemoved((cur) => [...cur, a.id])}
                />
              </View>
            ))}
            {pending.map((f, i) => (
              <View key={`p${i}`} style={styles.fileRow}>
                <Text style={[styles.fileName, { color: t.text }]}>
                  {`${f.name} · ${formatSize(f.size)} · not saved yet`}
                </Text>
                <Button
                  label="Remove"
                  onPress={() => setPending((cur) => cur.filter((_, j) => j !== i))}
                />
              </View>
            ))}
            <View style={styles.rowWrap}>
              <Button
                label="Attach a file"
                disabled={fileCount >= MAX_ATTACHMENTS}
                onPress={() => void pickFiles()}
              />
            </View>
            {fileCount >= MAX_ATTACHMENTS ? (
              <Text style={{ color: t.textMuted, fontSize: 14, lineHeight: 20 }}>
                {`${MAX_ATTACHMENTS} files is the limit for one task. Remove one to attach another.`}
              </Text>
            ) : null}
          </View>

          <View style={styles.rowWrap}>
            <Button label="Cancel" onPress={onCancel} />
            <Button
              label="Save"
              primary
              disabled={!canSave}
              onPress={() =>
                onSave(
                  {
                    title: title.trim(),
                    description: description.trim(),
                    dueAt,
                    remind: remind && dueAt !== null,
                  },
                  { removeIds: removed, add: pending },
                )
              }
            />
          </View>
        </ScrollView>
        {/* Painted after the ScrollView, so it covers it. Opaque, the window's
            own background colour, exactly as tall as the status bar: scrolled
            content disappears behind it instead of colliding with the clock.
            pointerEvents="none" so it never swallows a touch. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: insets.top,
            backgroundColor: t.background,
          }}
        />
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
  notes: { minHeight: MIN_TOUCH * 2, textAlignVertical: 'top' },
  fileRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  fileName: { flex: 1, minWidth: 140, fontSize: 15, lineHeight: 22 },
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
