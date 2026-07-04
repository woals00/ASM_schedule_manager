// One day-cell in the 14-day dashboard grid. Renders the date header and the
// ordered list of LectureCard entries.

import { cx } from '@shared/ui/cx';
import { LectureCard, lectureCardCss } from './LectureCard';
import type { Lecture } from '../lectures/types';
import styles from './CalendarCell.module.css';
import css from './CalendarCell.module.css?inline';

export const calendarCellCss = [css, lectureCardCss].join('\n');

export interface GoogleCalendarMatchResponse {
  connected: boolean;
  matched: Record<string, boolean>;
  error?: string;
}

export interface EventEntry {
  data: Lecture;
  timeKey: string;
  ended: boolean;
  matchKey: string;
  dismissed: boolean;
}

export interface CalendarCellProps {
  dateStr: string;
  isToday: boolean;
  isPast: boolean;
  formattedDateText: string;
  events: EventEntry[];
  googleCalendarMatch: GoogleCalendarMatchResponse;
  registeredFeedbackIds: Set<string>;
  deletedFromGoogleFeedbackIds: Set<string>;
  onCancelLecture(somaLectureId: string): void;
  onDismissLecture(matchKey: string): void;
  onRestoreLecture(matchKey: string): void;
}

export function CalendarCell({
  dateStr,
  isToday,
  isPast,
  formattedDateText,
  events,
  googleCalendarMatch,
  registeredFeedbackIds,
  deletedFromGoogleFeedbackIds,
  onCancelLecture,
  onDismissLecture,
  onRestoreLecture,
}: CalendarCellProps) {
  return (
    <div
      className={cx(styles.calendarCell, { [styles.pastDay]: isPast })}
      data-calendar-date={dateStr}
    >
      <div className={styles.calendarDateHeaderRow}>
        <div className={styles.calendarDateLeft}>
          {isToday && <span className={styles.todayBadge}>오늘</span>}
          <span className={styles.calendarDate}>{formattedDateText}</span>
        </div>
      </div>

      {events.map((evt, idx) => {
        const lec = evt.data;
        // matchKey precomputed in CalendarView (active → id; mentor-deleted → title+date+start).
        const matchKey = evt.matchKey;
        const hasKey = Boolean(matchKey);
        const matchedVal = hasKey ? googleCalendarMatch.matched[matchKey] : undefined;
        // Deleted lectures never prompt "미등록" — a removed lecture shouldn't ask
        // to be added to the calendar; it only ever lingers and gets cleaned up.
        const missingFromGoogleCalendar =
          googleCalendarMatch.connected &&
          !evt.ended &&
          !lec.mentorDeleted &&
          hasKey &&
          matchedVal === false;
        const justRegistered =
          !missingFromGoogleCalendar &&
          hasKey &&
          registeredFeedbackIds.has(matchKey);
        const justDeletedFromGoogle = hasKey && deletedFromGoogleFeedbackIds.has(matchKey);
        const deletedButInGoogle =
          !evt.dismissed &&
          !justDeletedFromGoogle &&
          googleCalendarMatch.connected &&
          lec.mentorDeleted &&
          hasKey &&
          matchedVal === true;
        return (
          <LectureCard
            key={`l-${lec.somaLectureId || idx}`}
            lec={lec}
            ended={evt.ended}
            dismissed={evt.dismissed}
            missingFromGoogleCalendar={missingFromGoogleCalendar}
            justRegistered={justRegistered}
            deletedButInGoogle={deletedButInGoogle}
            justDeletedFromGoogle={justDeletedFromGoogle}
            onCancel={() => onCancelLecture(lec.somaLectureId)}
            onDismiss={() => onDismissLecture(matchKey)}
            onRestore={() => onRestoreLecture(matchKey)}
          />
        );
      })}
    </div>
  );
}
