// Top toolbar of the dashboard calendar: title, week navigation, and refresh.

import { cx } from '@shared/ui/cx';
import styles from './CalendarHeader.module.css';
import css from './CalendarHeader.module.css?inline';

export const calendarHeaderCss = css;

export interface CalendarHeaderProps {
  disabled: boolean;
  refreshing: boolean;
  onPrevWeeks(): void;
  onToday(): void;
  onNextWeeks(): void;
  onRefresh(): void | Promise<void>;
}

export function CalendarHeader({
  disabled,
  refreshing,
  onPrevWeeks,
  onToday,
  onNextWeeks,
  onRefresh,
}: CalendarHeaderProps) {
  return (
    <div className={styles.calendarHeader}>
      <div className={styles.calendarTitleGroup}>
        <h3>통합 일정 대시보드</h3>
        <span className={styles.calendarSubtitle}>
          접수한 멘토링 일정을 한눈에 모아 관리합니다.
        </span>
      </div>
      <div className={styles.calendarNavGroup}>
        <button
          className={cx(styles.controlBtn, styles.navBtn)}
          disabled={disabled}
          onClick={onPrevWeeks}
        >
          ‹ 2주 전
        </button>
        <button
          className={cx(styles.controlBtn, styles.navBtn, styles.navToday)}
          disabled={disabled}
          onClick={onToday}
        >
          오늘
        </button>
        <button
          className={cx(styles.controlBtn, styles.navBtn)}
          disabled={disabled}
          onClick={onNextWeeks}
        >
          2주 후 ›
        </button>
      </div>
      <div className={styles.calendarActions}>
        <button
          className={cx(styles.controlBtn, styles.navBtn)}
          title="최신 데이터로 새로고침"
          disabled={disabled || refreshing}
          onClick={() => void onRefresh()}
        >
          {refreshing ? '↻ 새로고침 중…' : '↻ 새로고침'}
        </button>
      </div>
    </div>
  );
}
