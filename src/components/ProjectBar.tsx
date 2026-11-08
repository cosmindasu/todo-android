import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Project } from '../db/projects';
import { MIN_TOUCH, useTheme } from '../theme/colors';
import { Button } from './TodoEditor';

/**
 * Project switcher: one row of chips, the active one filled.
 *
 * A row rather than a navigator on purpose — the app is deliberately one
 * screen, and adding a navigation library to switch between lists of ten items
 * would cost more than it explains. The row scrolls horizontally, so the number
 * of projects is not limited by the width of the phone.
 *
 * Renaming and deleting hang off a long press on the active chip. That is the
 * conventional Android gesture for "more about this thing", and it keeps a
 * second row of buttons off a screen that already has a banner, a list and a
 * primary action.
 */
interface Props {
  projects: readonly Project[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onLongPress: (p: Project) => void;
}

export function ProjectBar({ projects, activeId, onSelect, onAdd, onLongPress }: Props) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // `flexGrow: 0` is load-bearing. A ScrollView carries its own
      // `flexGrow: 1`, so inside a column it expands to fill whatever height
      // is going — measured here as a band of empty space between the heading
      // and the list, even though the content is one row of chips. Horizontal
      // scrolling does not change that: the growth is on the cross axis.
      style={styles.scroll}
      contentContainerStyle={styles.bar}
      // The chips are a row of controls, not a list of headings.
      accessibilityRole="tablist"
    >
      {projects.map((p) => {
        const active = p.id === activeId;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Project ${p.name}`}
            accessibilityHint={active ? 'Long press to rename or delete' : 'Show this project'}
            onPress={() => onSelect(p.id)}
            onLongPress={() => onLongPress(p)}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: active ? t.accent : t.border,
                backgroundColor: active ? t.accent : 'transparent',
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: active ? t.onAccent : t.text }]}>{p.name}</Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New project"
        onPress={onAdd}
        style={({ pressed }) => [
          styles.chip,
          { borderColor: t.border, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text style={[styles.chipText, { color: t.text }]}>+ New</Text>
      </Pressable>
    </ScrollView>
  );
}

/**
 * Ask for one line of text. `Alert.prompt` exists only on iOS, so an
 * Android-only app that wants a name has to bring its own.
 */
export function NameDialog({
  visible,
  title,
  initial,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  initial: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initial);

  useEffect(() => {
    if (visible) setName(initial);
  }, [visible, initial]);

  const trimmed = name.trim();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      {/* A React Native Modal gets its OWN window, so the activity's
          `adjustResize` does not apply to it: an input anchored to the bottom
          ends up behind the keyboard, which is what happened here. The
          KeyboardAvoidingView listens to RN's own keyboard events instead, so
          it works inside a Modal, and `padding` is the behaviour that keeps a
          centred dialog in the space that is left. */}
      <KeyboardAvoidingView behavior="padding" style={styles.scrim}>
        <View
          style={[
            styles.dialog,
            { backgroundColor: t.background, borderColor: t.border, marginBottom: insets.bottom },
          ]}
        >
          <Text accessibilityRole="header" style={[styles.dialogTitle, { color: t.text }]}>
            {title}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder="Project name"
            placeholderTextColor={t.textMuted}
            accessibilityLabel={title}
            style={[
              styles.input,
              { color: t.text, borderColor: t.border, backgroundColor: t.surface },
            ]}
          />
          <View style={styles.dialogButtons}>
            <Button label="Cancel" onPress={onCancel} />
            <Button
              label={confirmLabel}
              primary
              disabled={trimmed.length === 0}
              onPress={() => onConfirm(trimmed)}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  bar: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, alignItems: 'center' },
  chip: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: MIN_TOUCH / 2,
  },
  chipText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  scrim: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center' },
  dialog: { borderTopWidth: 1, borderRadius: 16, margin: 12, padding: 16, gap: 12 },
  dialogTitle: { fontSize: 20, fontWeight: '700', lineHeight: 28 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, lineHeight: 24 },
  dialogButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
});
