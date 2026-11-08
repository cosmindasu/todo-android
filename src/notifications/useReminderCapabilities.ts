import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getCapabilities, type ReminderCapabilities } from './reminders';

/**
 * Current notification / exact-alarm state. Re-checked every time the app comes
 * back to the foreground, because the user can change both in system settings
 * at any moment (and we send them there ourselves).
 */
export function useReminderCapabilities() {
  const [caps, setCaps] = useState<ReminderCapabilities | null>(null);

  const refresh = useCallback(async () => {
    setCaps(await getCapabilities());
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { caps, refresh };
}
