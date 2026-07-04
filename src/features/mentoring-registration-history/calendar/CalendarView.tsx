// Two-week dashboard calendar — orchestrator. State (week offset, Google
// Calendar match, refreshing) lives here; rendering is split across
// CalendarHeader / CalendarCell / LectureCard.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DAY_KO, isLectureEnded, parseLectureDateTimeText, toDateStr } from '@shared/date/date-time';
import {
  saveMentoringSchedules,
  type MentoringSchedule,
} from '@features/schedules/mentoring-schedule';
import { lectureMatchKey } from '@features/google-calendar/match-key';
import { cx } from '@shared/ui/cx';
import { triggerCancellation } from '../lectures/cancel';
import {
  addDismissedDeletedLectureKeys,
  loadDismissedDeletedLectureKeys,
  removeDismissedDeletedLectureKeys,
} from '../lectures/dismissed-lectures';
import { CalendarHeader, calendarHeaderCss } from './CalendarHeader';
import { CalendarCell, calendarCellCss, type EventEntry } from './CalendarCell';
import { useGoogleCalendarMatch } from './useGoogleCalendarMatch';
import type { Lecture } from '../lectures/types';
import baseStyles from './CalendarView.module.css';
import cellStyles from './CalendarCell.module.css';
import baseCss from './CalendarView.module.css?inline';

export const calendarCss = [baseCss, calendarHeaderCss, calendarCellCss].join('\n');

const CALENDAR_DAY_COUNT = 14;
const CALENDAR_SHIFT_WEEKS = 2;

function buildMentoringSchedules(lectures: Lecture[]): MentoringSchedule[] {
  return lectures
    .map((l) => {
      const parsed = parseLectureDateTimeText(l.dateTimeText);
      if (!parsed || !l.dateStr) return null;
      return {
        somaLectureId: l.somaLectureId || '',
        title: l.title || '',
        dateStr: l.dateStr,
        startTime: `${parsed.sh}:${parsed.sm}`,
        endTime: `${parsed.eh}:${parsed.em}`,
      } satisfies MentoringSchedule;
    })
    .filter((ms): ms is MentoringSchedule => ms !== null);
}

// Google Calendar match key for a lecture (mirrors buildMentoringSchedules's
// parsing so keys line up with the matcher). '' when the time can't be parsed.
function lectureKeyOf(l: Lecture): string {
  const parsed = parseLectureDateTimeText(l.dateTimeText);
  if (!parsed || !l.dateStr) return '';
  return lectureMatchKey(l.somaLectureId, l.title || '', l.dateStr, `${parsed.sh}:${parsed.sm}`);
}

export interface CalendarProps {
  loading: boolean;
  lectures: Lecture[];
  onRefresh(): Promise<void> | void;
}

export function Calendar({ loading, lectures, onRefresh }: CalendarProps) {
  const [startOffsetWeeks, setStartOffsetWeeks] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dismissedDeletedKeys, setDismissedDeletedKeys] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    void loadDismissedDeletedLectureKeys().then(setDismissedDeletedKeys);
  }, [refreshKey]);

  const mentoringSchedules = useMemo(
    () => buildMentoringSchedules(lectures),
    [lectures],
  );

  const mentorDeletedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const l of lectures) {
      if (!l.mentorDeleted) continue;
      const key = lectureKeyOf(l);
      if (key) keys.add(key);
    }
    return keys;
  }, [lectures]);

  // Persist mentoring schedules so the detail-page conflict checker can read them.
  useEffect(() => {
    if (loading) return;
    void saveMentoringSchedules(mentoringSchedules);
  }, [loading, mentoringSchedules]);

  // Permanently hide deleted-lecture cards (state first to avoid a flicker, then
  // persist across reloads). Used by both the "삭제됨!" pulse settle and the manual ×.
  const dismissDeletedKeys = useCallback((keys: string[]) => {
    setDismissedDeletedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    void addDismissedDeletedLectureKeys(keys);
  }, []);

  const handleManualDismiss = useCallback(
    (key: string) => {
      if (!key) return;
      if (!confirm('이 "강의 삭제됨" 카드를 목록에서 숨길까요?')) return;
      dismissDeletedKeys([key]);
    },
    [dismissDeletedKeys],
  );

  const handleRestore = useCallback((key: string) => {
    if (!key) return;
    setDismissedDeletedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    void removeDismissedDeletedLectureKeys([key]);
  }, []);

  // Count of hidden cards actually present in the current data (drives the toggle).
  const hiddenCount = useMemo(() => {
    let n = 0;
    for (const l of lectures) {
      if (!l.mentorDeleted) continue;
      const key = lectureKeyOf(l);
      if (key && dismissedDeletedKeys.has(key)) n += 1;
    }
    return n;
  }, [lectures, dismissedDeletedKeys]);

  // Leave "manage hidden" mode automatically once nothing is hidden anymore.
  useEffect(() => {
    if (hiddenCount === 0 && showHidden) setShowHidden(false);
  }, [hiddenCount, showHidden]);

  const { googleCalendarMatch, registeredFeedbackIds, deletedFromGoogleFeedbackIds } =
    useGoogleCalendarMatch(mentoringSchedules, loading, mentorDeletedKeys, dismissDeletedKeys);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('SOMA Schedule Manager: refresh failed', err);
      alert('새로고침 중 오류가 발생했습니다.');
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, refreshing]);

  // --- Render ---

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const startDate = useMemo(() => {
    const sun = new Date(today);
    sun.setDate(today.getDate() - today.getDay());
    sun.setDate(sun.getDate() + startOffsetWeeks * 7);
    return sun;
  }, [today, startOffsetWeeks]);

  const days = useMemo(() => {
    const out: { date: Date; dateStr: string; isToday: boolean; isPast: boolean; formattedDateText: string }[] = [];
    for (let i = 0; i < CALENDAR_DAY_COUNT; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = toDateStr(d);
      out.push({
        date: d,
        dateStr,
        isToday: d.getTime() === today.getTime(),
        isPast: d.getTime() < today.getTime(),
        formattedDateText: `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_KO[d.getDay()]})`,
      });
    }
    return out;
  }, [startDate, today]);

  // Build each day's ordered event list once. Independent of the Google Calendar
  // match state, so frequent match/feedback updates re-render cells with new props
  // instead of re-parsing every lecture's date-time text on each update.
  const eventsByDay = useMemo(() => {
    return days.map((day) => {
      const events: EventEntry[] = [];
      for (const l of lectures) {
        if (l.dateStr !== day.dateStr) continue;
        const parsed = parseLectureDateTimeText(l.dateTimeText);
        const matchKey = parsed
          ? lectureMatchKey(l.somaLectureId, l.title || '', l.dateStr, `${parsed.sh}:${parsed.sm}`)
          : l.somaLectureId;
        // Mentor-deleted leftovers the user hid are dropped — unless "manage hidden"
        // mode is on, where they reappear faded with a 복원 button.
        const dismissed = l.mentorDeleted && Boolean(matchKey) && dismissedDeletedKeys.has(matchKey);
        if (dismissed && !showHidden) continue;
        events.push({
          data: l,
          timeKey: parsed ? `${parsed.sh}:${parsed.sm}` : '00:00',
          ended: isLectureEnded(l.dateTimeText),
          matchKey,
          dismissed,
        });
      }
      events.sort((a, b) => a.timeKey.localeCompare(b.timeKey));
      return { day, events };
    });
  }, [days, lectures, dismissedDeletedKeys, showHidden]);

  return (
    <div id="registration-history-calendar">
      <CalendarHeader
        disabled={loading}
        refreshing={refreshing}
        onPrevWeeks={() => setStartOffsetWeeks((w) => w - CALENDAR_SHIFT_WEEKS)}
        onToday={() => setStartOffsetWeeks(0)}
        onNextWeeks={() => setStartOffsetWeeks((w) => w + CALENDAR_SHIFT_WEEKS)}
        onRefresh={handleRefresh}
      />

      {loading ? (
        <div className={baseStyles.calendarLoadingPlaceholder}>
          <span className={baseStyles.calendarLoadingSpinner} aria-hidden="true" />
          <span className={baseStyles.calendarLoadingText}>
            접수한 강의 정보를 불러오는 중입니다…
          </span>
          <span className={baseStyles.calendarLoadingSubtext}>
            처음 로딩 시 강의 상세를 한 건씩 가져오느라 시간이 걸릴 수 있습니다.
          </span>
        </div>
      ) : (
        <>
          {hiddenCount > 0 && (
            <div className={baseStyles.hiddenManageRow}>
              <button
                type="button"
                className={baseStyles.hiddenToggleBtn}
                onClick={() => setShowHidden((v) => !v)}
              >
                {showHidden ? '숨김 관리 닫기' : `숨긴 강의 ${hiddenCount}개 보기`}
              </button>
            </div>
          )}
          <div className={cellStyles.calendarGrid}>
          {DAY_KO.map((wd, idx) => (
            <div
              key={`wd-${wd}`}
              className={cx(cellStyles.calendarWeekdayHeader, {
                [cellStyles.weekend]: idx === 0 || idx === 6,
              })}
            >
              {wd}
            </div>
          ))}
          {eventsByDay.map(({ day, events }) => (
            <CalendarCell
              key={day.dateStr}
              dateStr={day.dateStr}
              isToday={day.isToday}
              isPast={day.isPast}
              formattedDateText={day.formattedDateText}
              events={events}
              googleCalendarMatch={googleCalendarMatch}
              registeredFeedbackIds={registeredFeedbackIds}
              deletedFromGoogleFeedbackIds={deletedFromGoogleFeedbackIds}
              onCancelLecture={triggerCancellation}
              onDismissLecture={handleManualDismiss}
              onRestoreLecture={handleRestore}
            />
          ))}
          </div>
        </>
      )}
    </div>
  );
}
