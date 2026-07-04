// The month grid of the mentoLec board panel: weekday headers + day cells with
// per-day event counts and category dots. Selection state lives in MentoLecPanel;
// this component is purely presentational. Reuses MentoLecPanel's CSS module.

import { cx } from '@shared/ui/cx';
import { sortEventsByStatusTimeAuthor, type EventRecord } from './events';
import styles from './MentoLecPanel.module.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const dotCategoryClasses: Record<string, string> = {
  MRC010: styles.asmDotMrc010,
  MRC020: styles.asmDotMrc020,
};

export interface MentoLecCalendarGridProps {
  byDate: Map<string, EventRecord[]>;
  todayStr: string;
  selectedDate: string | null;
  leadingEmptyCount: number;
  onSelectDate(dateStr: string): void;
}

export function MentoLecCalendarGrid({
  byDate,
  todayStr,
  selectedDate,
  leadingEmptyCount,
  onSelectDate,
}: MentoLecCalendarGridProps) {
  return (
    <div className={styles.asmCalSection}>
      <div className={styles.asmCalWeekdays}>
        {WEEKDAYS.map((wd, i) => (
          <div
            key={wd}
            className={cx(styles.asmCalWd, {
              [styles.asmWdWeekend]: i === 0 || i === 6,
            })}
          >
            {wd}
          </div>
        ))}
      </div>

      <div className={styles.asmCalGrid}>
        {Array.from({ length: leadingEmptyCount }, (_, i) => (
          <div key={`empty-${i}`} className={cx(styles.asmCalDay, styles.asmCalEmpty)} />
        ))}
        {[...byDate.entries()].map(([dateStr, dayEvents]) => {
          const d = new Date(dateStr + 'T00:00:00');
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const sortedDay = [...dayEvents].sort((a, b) =>
            sortEventsByStatusTimeAuthor(a, b, todayStr),
          );
          const hasEvents = sortedDay.length > 0;
          const isSelected = selectedDate === dateStr;
          const maxDots = Math.min(sortedDay.length, 5);

          return (
            <div
              key={dateStr}
              data-date={dateStr}
              className={cx(styles.asmCalDay, {
                [styles.asmCalToday]: isToday,
                [styles.asmCalPast]: isPast,
                [styles.asmCalWeekend]: isWeekend,
                [styles.asmCalHasEvents]: hasEvents,
                [styles.asmCalSelected]: isSelected,
              })}
              onClick={() => {
                if (!hasEvents) return;
                onSelectDate(dateStr);
              }}
            >
              <div className={styles.asmCalDaynum}>{d.getDate()}</div>
              {hasEvents && (
                <>
                  <div className={styles.asmCalCnt}>{sortedDay.length}건</div>
                  <div className={styles.asmCalDots}>
                    {sortedDay.slice(0, maxDots).map((ev, i) => {
                      const isGray = ev.date < todayStr || ev.isClosed;
                      return (
                        <span
                          key={`${ev.somaLectureId || i}-dot`}
                          className={cx(
                            styles.asmDot,
                            isGray ? styles.asmDotGray : dotCategoryClasses[ev.category],
                          )}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
