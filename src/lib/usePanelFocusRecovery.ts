import { useLayoutEffect, useRef } from 'react';

// The panel's last tab disappears before focus can move to a surviving tab.
export function usePanelFocusRecovery(open: boolean) {
  const target = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (wasOpen.current && !open) target.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return target;
}
