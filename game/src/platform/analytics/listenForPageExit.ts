type EventTargetLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Calls the listener when the page becomes hidden (also how mobile browsers switch apps)
 * or is being unloaded. Returns the unsubscribe function.
 */
export const listenForPageExit = (
  doc: EventTargetLike & Pick<Document, 'visibilityState'>,
  win: EventTargetLike,
  listener: () => void
): (() => void) => {
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') listener();
  };
  doc.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('pagehide', listener);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    win.removeEventListener('pagehide', listener);
  };
};
