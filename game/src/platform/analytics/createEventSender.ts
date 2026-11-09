import { NoopEventSender, type EventSender } from './AnalyticsEvent';
import { HttpEventSender } from './HttpEventSender';
import { listenForPageExit } from './listenForPageExit';

/** The browser's EventSender for a backend URL, or a no-op one when none is configured. */
export const createEventSender = (url: string | undefined): EventSender => {
  if (!url) return new NoopEventSender();
  return new HttpEventSender({
    url,
    fetch: (target, init) => fetch(target, init),
    sendBeacon: (target, body) => navigator.sendBeacon(target, body),
    timers: {
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number)
    },
    onPageExit: (listener) => listenForPageExit(document, window, listener),
    random: Math.random
  });
};
