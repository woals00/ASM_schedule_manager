// Imperative shim around <Calendar/>. Keeps the existing API consumed by
// the mentoring registration history entrypoint (renderCalendar / renderCalendarSkeleton) so the
// migration is non-invasive at the integration point.

import { mountReact, type MountHandle } from '@shared/dom/react-mount';
import { Calendar, calendarCss } from './CalendarView';
import { clearLectureDetailCache } from '../lectures/lecture-detail';
import { parseLecturesTable } from '../lectures/lecture-table';
import type { Lecture } from '../lectures/types';

let handle: MountHandle | null = null;
let currentLectures: Lecture[] = [];
let loading = true;

async function refreshLectures(): Promise<void> {
  await clearLectureDetailCache();
  try {
    await chrome.runtime.sendMessage({ type: 'asm-google-calendar-clear-cache' });
  } catch {
    // Google Calendar cache clear is best-effort
  }
  currentLectures = await parseLecturesTable();
  loading = false;
  render();
}

function ensureHostMounted(): HTMLElement | null {
  if (handle) return null;
  const targetContainer = document.querySelector('.tabs-st1');
  if (!targetContainer || !targetContainer.parentNode) return null;

  const host = document.createElement('div');
  host.id = 'registration-history-calendar-react-host';
  targetContainer.parentNode.insertBefore(host, targetContainer.nextSibling);
  return host;
}

function render(): void {
  const node = (
    <Calendar loading={loading} lectures={currentLectures} onRefresh={refreshLectures} />
  );

  if (!handle) {
    const host = ensureHostMounted();
    if (!host) return;
    handle = mountReact(host, node, {
      styles: [calendarCss],
      hostClass: 'asm-registration-history-calendar-host',
    });
  } else {
    handle.rerender(node);
  }
}

export function renderCalendarSkeleton(): void {
  loading = true;
  currentLectures = [];
  render();
}

export async function renderCalendar(lectures: Lecture[]): Promise<void> {
  loading = false;
  currentLectures = lectures;
  render();
}
