import {
  clearEventCache as clearGoogleCalendarEventCache,
  connect as connectGoogleCalendar,
  disconnect as disconnectGoogleCalendar,
  isConnected as isGoogleCalendarConnected,
  matchLectures as matchGoogleCalendarLectures,
  type LectureMatchInput,
} from '@features/google-calendar/google-calendar';

interface GoogleCalendarStatusMessage {
  type: 'asm-google-calendar-status';
}
interface GoogleCalendarConnectMessage {
  type: 'asm-google-calendar-connect';
}
interface GoogleCalendarDisconnectMessage {
  type: 'asm-google-calendar-disconnect';
}
interface GoogleCalendarMatchMessage {
  type: 'asm-google-calendar-match';
  lectures: LectureMatchInput[];
}
interface GoogleCalendarClearCacheMessage {
  type: 'asm-google-calendar-clear-cache';
}

type IncomingMessage =
  | GoogleCalendarStatusMessage
  | GoogleCalendarConnectMessage
  | GoogleCalendarDisconnectMessage
  | GoogleCalendarMatchMessage
  | GoogleCalendarClearCacheMessage;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function classifyMessage(value: unknown): IncomingMessage | null {
  if (!isObject(value)) return null;
  const type = value.type;
  if (type === 'asm-google-calendar-status') return { type };
  if (type === 'asm-google-calendar-connect') return { type };
  if (type === 'asm-google-calendar-disconnect') return { type };
  if (type === 'asm-google-calendar-match' && Array.isArray(value.lectures)) {
    return { type, lectures: value.lectures as LectureMatchInput[] };
  }
  if (type === 'asm-google-calendar-clear-cache') return { type };
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = classifyMessage(message);
  if (!msg) return undefined;

  (async () => {
    if (msg.type === 'asm-google-calendar-status') {
      const connected = await isGoogleCalendarConnected();
      sendResponse({ connected });
      return;
    }

    if (msg.type === 'asm-google-calendar-connect') {
      const res = await connectGoogleCalendar();
      sendResponse(res);
      return;
    }

    if (msg.type === 'asm-google-calendar-disconnect') {
      await disconnectGoogleCalendar();
      sendResponse({ connected: false });
      return;
    }

    if (msg.type === 'asm-google-calendar-match') {
      const res = await matchGoogleCalendarLectures(msg.lectures);
      sendResponse(res);
      return;
    }

    if (msg.type === 'asm-google-calendar-clear-cache') {
      await clearGoogleCalendarEventCache();
      sendResponse({ ok: true });
      return;
    }
  })();

  return true;
});
