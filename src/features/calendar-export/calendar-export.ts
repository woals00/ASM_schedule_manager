// SOMA Schedule Manager - Calendar Export
// Generates Google Calendar "create event" URLs and downloadable ICS files locally.
// No backend, no API key. Exposes globalThis.ASMCalendarExport for legacy .js
// callers; once all callers migrate to TS this surface can be replaced with ESM
// imports.

import { iconHtml } from '@shared/ui/icons';

export interface ExportEvent {
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  description?: string;
  uid?: string;
}

export interface ASMCalendarExportAPI {
  buildGoogleCalendarUrl(event: ExportEvent): string;
  buildIcsContent(event: ExportEvent): string;
  openGoogleCalendar(event: ExportEvent): void;
  downloadIcs(filenameBase: string, event: ExportEvent): void;
  appendExportButtons(
    container: HTMLElement,
    getEvent: () => ExportEvent | null,
    filenameBase: string
  ): void;
}

const GOOGLE_CALENDAR_OPENED_EVENT = 'asm:google-calendar-opened';

function toUtcCompact(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function buildGoogleCalendarUrl(event: ExportEvent): string {
  const start = toUtcCompact(event?.startsAt);
  const end = toUtcCompact(event?.endsAt);
  if (!start || !end) return '';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || '(제목 없음)',
    dates: `${start}/${end}`,
    details: event.description || '',
    location: event.location || '',
    ctz: 'Asia/Seoul',
  });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function escapeIcsText(text: string | undefined): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// RFC 5545 line folding at 75 octets (char-approx; sufficient for ASCII/2-byte Korean glyphs commonly seen here)
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) {
    parts.push(' ' + line.slice(i, i + 74));
  }
  return parts.join('\r\n');
}

function buildIcsContent(event: ExportEvent): string {
  const start = toUtcCompact(event?.startsAt);
  const end = toUtcCompact(event?.endsAt);
  if (!start || !end) return '';
  const stamp = toUtcCompact(new Date().toISOString());
  const uid =
    event.uid ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@asm-schedule-manager`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ASM Schedule Manager//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    foldIcsLine(`UID:${uid}`),
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    foldIcsLine(`SUMMARY:${escapeIcsText(event.title)}`),
  ];
  if (event.description) {
    lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(event.description)}`));
  }
  if (event.location) {
    lines.push(foldIcsLine(`LOCATION:${escapeIcsText(event.location)}`));
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function sanitizeFilename(name: string): string {
  const cleaned = String(name || 'event')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return cleaned || 'event';
}

function openGoogleCalendar(event: ExportEvent): void {
  const url = buildGoogleCalendarUrl(event);
  if (!url) {
    alert('일정 시간을 변환할 수 없어 Google 캘린더에 추가할 수 없습니다.');
    return;
  }
  window.dispatchEvent(new CustomEvent(GOOGLE_CALENDAR_OPENED_EVENT));
  window.open(url, '_blank', 'noopener');
}

function downloadIcs(filenameBase: string, event: ExportEvent): void {
  const content = buildIcsContent(event);
  if (!content) {
    alert('일정 시간을 변환할 수 없어 ICS 파일을 만들 수 없습니다.');
    return;
  }
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filenameBase) + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface CreateExportButtonOptions {
  label: string;
  title: string;
  className: string;
  onClick: () => void;
}

function createExportButton({
  label,
  title,
  className,
  onClick,
}: CreateExportButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.innerHTML = label;
  btn.title = title;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// getEvent: () => ExportEvent | null. Returning null cancels the export
// (caller may have already alerted the user).
function appendExportButtons(
  container: HTMLElement,
  getEvent: () => ExportEvent | null,
  filenameBase: string
): void {
  const googleCalendarButton = createExportButton({
    label: `${iconHtml('calendar')}<span>캘린더</span>`,
    title: 'Google 캘린더에 추가',
    className: 'asm-export-btn google-calendar-btn',
    onClick: () => {
      const event = getEvent();
      if (event) openGoogleCalendar(event);
    },
  });
  const btnIcs = createExportButton({
    label: `${iconHtml('save')}<span>ICS</span>`,
    title: 'ICS 파일 다운로드 (Outlook · Apple · Naver 등)',
    className: 'asm-export-btn ics-btn',
    onClick: () => {
      const event = getEvent();
      if (event) downloadIcs(filenameBase, event);
    },
  });
  container.appendChild(googleCalendarButton);
  container.appendChild(btnIcs);
}

const api: ASMCalendarExportAPI = {
  buildGoogleCalendarUrl,
  buildIcsContent,
  openGoogleCalendar,
  downloadIcs,
  appendExportButtons,
};

declare global {
  // eslint-disable-next-line no-var
  var ASMCalendarExport: ASMCalendarExportAPI | undefined;
}

globalThis.ASMCalendarExport = api;
