import type { MentoringSchedule } from '@features/schedules/mentoring-schedule';

interface TimedEvent {
  date: string;
  timeStart: string;
  timeEnd: string;
  somaLectureId?: string | null;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export function toDateRange(dateStr: string, startTime: string, endTime: string): DateRange | null {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if ([y, m, d, sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;

  return {
    start: new Date(y, m - 1, d, sh, sm, 0),
    end: new Date(y, m - 1, d, eh, em, 0),
  };
}

export function overlaps(a: DateRange, b: DateRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function hasMentoringScheduleConflict(
  ev: TimedEvent,
  mentoringSchedules: MentoringSchedule[]
): boolean {
  const evRange = ev?.date && ev?.timeStart && ev?.timeEnd
    ? toDateRange(ev.date, ev.timeStart, ev.timeEnd)
    : null;
  if (!evRange || !Array.isArray(mentoringSchedules)) return false;

  return (
    findConflictingMentoringSchedules(evRange, mentoringSchedules, ev.somaLectureId ?? undefined)
      .length > 0
  );
}

export function findConflictingMentoringSchedules(
  range: DateRange,
  mentoringSchedules: MentoringSchedule[],
  excludeSomaLectureId?: string
): MentoringSchedule[] {
  return mentoringSchedules.filter((ms) => {
    if (!ms?.dateStr || !ms?.startTime || !ms?.endTime) return false;
    if (excludeSomaLectureId && ms.somaLectureId === excludeSomaLectureId) return false;
    const msRange = toDateRange(ms.dateStr, ms.startTime, ms.endTime);
    return msRange ? overlaps(range, msRange) : false;
  });
}
