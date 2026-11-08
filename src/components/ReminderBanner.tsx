import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  requestExactAlarmAccess,
  requestNotificationPermission,
  type ReminderCapabilities,
} from '../notifications/reminders';
import { MIN_TOUCH, useTheme } from '../theme/colors';

interface Props {
  caps: ReminderCapabilities;
  onChanged: () => void;
}

/**
 * Shows only when reminders cannot work properly, and offers the one action
 * that fixes the current problem. Nothing is requested at app start: the user
 * sees a reason first, then chooses.
 */
export function ReminderBanner({ caps, onChanged }: Props) {
  const t = useTheme();

  let message: string | null = null;
  let action: string | null = null;
  let run: (() => Promise<unknown> | void) | null = null;

  if (caps.notifications === 'undetermined' || caps.notifications === 'denied-can-ask') {
    message = 'Reminders need permission to show notifications.';
    action = 'Allow notifications';
    run = requestNotificationPermission;
  } else if (caps.notifications === 'denied-blocked') {
    // Android will not show the dialog again; only system settings can undo this.
    message = 'Notifications are blocked for this app. Tasks still work, but reminders will not appear.';
    action = 'Open app settings';
    run = () => Linking.openSettings();
  } else if (!caps.exactAlarms) {
    message = 'Reminders may arrive late. Allow "Alarms & reminders" for on-time delivery.';
    action = 'Allow exact alarms';
    run = requestExactAlarmAccess;
  }

  if (!message || !action || !run) return null;

  return (
    <View
      style={[styles.box, { backgroundColor: t.warningBg, borderColor: t.warningText }]}
      accessibilityRole="alert"
    >
      <Text style={[styles.text, { color: t.warningText }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={async () => {
          await run?.();
          onChanged();
        }}
        style={({ pressed }) => [
          styles.button,
          { borderColor: t.warningText, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Text style={[styles.buttonText, { color: t.warningText }]}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, padding: 12, marginHorizontal: 16, marginBottom: 8, gap: 8 },
  text: { fontSize: 15, lineHeight: 22 },
  button: {
    minHeight: MIN_TOUCH,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 24,
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
