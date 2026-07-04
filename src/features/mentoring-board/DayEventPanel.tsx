// The right-side panel that shows the selected day's events.

import { DAY_KO } from '@shared/date/date-time';
import { EventCard } from './EventCard';
import type { EventRecord } from './events';
import styles from './DayEventPanel.module.css';
import css from './DayEventPanel.module.css?inline';

export const dayEventPanelCss = css;

export interface DayEventPanelProps {
  dateStr: string;
  dayEvents: EventRecord[];
  todayStr: string;
  loadingMessage: string | null;
}

export function DayEventPanel({
  dateStr,
  dayEvents,
  todayStr,
  loadingMessage,
}: DayEventPanelProps) {
  const d = new Date(dateStr + 'T00:00:00');
  return (
    <>
      <div className={styles.asmEventPanelHeader}>
        <span className={styles.asmEventPanelDate}>
          {d.getMonth() + 1}.{String(d.getDate()).padStart(2, '0')}({DAY_KO[d.getDay()]})
        </span>
        <span className={styles.asmEventPanelCnt}>{dayEvents.length}건</span>
      </div>
      {dayEvents.length === 0 && loadingMessage ? (
        <div className={styles.asmCardsLoading}>
          <span className={styles.asmLoadingSpinner} />
          <span>{loadingMessage}</span>
        </div>
      ) : (
        <div className={styles.asmDayCards}>
          {dayEvents.map((ev, i) => (
            <EventCard key={ev.somaLectureId || `${ev.title}-${i}`} ev={ev} todayStr={todayStr} />
          ))}
        </div>
      )}
    </>
  );
}
