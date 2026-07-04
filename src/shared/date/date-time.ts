// Date/time parsing helpers shared by mentoLec and mentoring registration history entries.

export interface ParsedLectureDateTime {
  y: string;
  m: string;
  d: string;
  sh: string;
  sm: string;
  eh: string;
  em: string;
}

export interface MonthRange {
  start: Date;
  end: Date;
  today: Date;
  year: number;
  month: number;
}

export const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getMonthRange(offset = 0): MonthRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { start: base, end, today, year: base.getFullYear(), month: base.getMonth() };
}

// Builds an ISO-8601 string pinned to KST (+09:00) from a "YYYY-MM-DD" date and
// "HH:MM" time. Returns '' when either part is missing or non-numeric.
export function kstToIso(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) return '';
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`;
}

export function timeToMinutes(time: string): number {
  if (!time) return 24 * 60 + 999;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 24 * 60 + 999;
  return h * 60 + m;
}

// Accepts SOMA's lecture date-time strings in several formats, e.g.:
//   "2026-03-05(목) 14:00 시 ~ 16:00 시", "2026/03/05 14:00 ~ 16:00",
//   "2026.03.05 14 ~ 16", "2026-03-05(목) 14:00:00 ~ 16:00:00"
export function parseLectureDateTimeText(dateTimeText: string | undefined | null): ParsedLectureDateTime | null {
  if (!dateTimeText) return null;

  const normalized = dateTimeText.replace(/\s+/g, ' ').trim();
  const match = normalized.match(
    /(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:\([^)]+\))?\s*(\d{1,2})(?::(\d{2})(?::\d{2})?)?\s*시?\s*~\s*(\d{1,2})(?::(\d{2})(?::\d{2})?)?\s*시?/
  );

  if (!match) return null;

  const [, y, m, d, sh, sm = '00', eh, em = '00'] = match;
  return {
    y,
    m: m.padStart(2, '0'),
    d: d.padStart(2, '0'),
    sh: sh.padStart(2, '0'),
    sm,
    eh: eh.padStart(2, '0'),
    em,
  };
}

export function getLectureDateBounds(dateTimeText: string | undefined | null): { start: Date; end: Date } | null {
  const parsed = parseLectureDateTimeText(dateTimeText);
  if (!parsed) return null;

  const { y, m, d, sh, sm, eh, em } = parsed;
  return {
    start: new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(sh, 10), parseInt(sm, 10), 0),
    end: new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(eh, 10), parseInt(em, 10), 0),
  };
}

export function isLectureEnded(dateTimeText: string | undefined | null): boolean {
  const bounds = getLectureDateBounds(dateTimeText);
  if (!bounds) return false;
  return bounds.end < new Date();
}
