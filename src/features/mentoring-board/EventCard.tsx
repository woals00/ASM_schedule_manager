// One event card in the mentoLec board. Wraps category / location / status
// badges, title, time, capacity, the SOMA detail link, and the GCal/ICS
// export buttons (bridged through lib/ExportSlot).

import { useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { classifyLocation } from '@shared/soma/location';
import { getSafeSomaUrl } from '@shared/soma/safe-url';
import { kstToIso } from '@shared/date/date-time';
import { cx } from '@shared/ui/cx';
import { Icon } from '@shared/ui/Icon';
import type { IconName } from '@shared/ui/icons';
import { ExportSlot } from '@shared/ui/ExportSlot';
import type { EventRecord } from './events';
import styles from './EventCard.module.css';
import css from './EventCard.module.css?inline';

export const eventCardCss = css;

const categoryClasses: Record<string, string> = {
  MRC010: styles.asmCatMrc010,
  MRC020: styles.asmCatMrc020,
};

function categoryClass(category: string): string | undefined {
  return categoryClasses[category];
}

function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return <span className={cx(styles.asmBadge, className)}>{children}</span>;
}

function IconBadge({
  icon,
  text,
  className,
}: {
  icon: IconName;
  text: string;
  className: string;
}) {
  return (
    <span className={cx(styles.asmBadge, styles.asmBadgeIcon, className)}>
      <Icon name={icon} size={12} />
      <span>{text}</span>
    </span>
  );
}

export interface EventCardProps {
  ev: EventRecord;
  todayStr: string;
}

export function EventCard({ ev, todayStr }: EventCardProps) {
  const isPast = ev.date < todayStr;
  const isGray = isPast || ev.isClosed;
  const safeUrl = getSafeSomaUrl(ev.url);
  const exporter = globalThis.ASMCalendarExport;
  const locInfo = ev.location ? classifyLocation(ev.location) : null;

  const openLecture = useCallback(() => {
    if (safeUrl) window.open(safeUrl, '_blank', 'noopener');
  }, [safeUrl]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLecture();
      }
    },
    [openLecture],
  );

  const statusLabel = isPast ? '진행완료' : ev.isClosed ? '마감' : '접수중';
  const statusCls = isPast
    ? styles.asmDone
    : ev.isClosed
      ? styles.asmClosed
      : styles.asmOpenBadge;
  const eventCategoryClass = categoryClass(ev.category);

  const exportDescription = useMemo(() => {
    const safe = getSafeSomaUrl(ev.url);
    return [
      ev.categoryNm,
      ev.author ? `${ev.author} 멘토` : '',
      safe ? `상세: ${safe}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }, [ev.categoryNm, ev.author, ev.url]);

  return (
    <div
      className={cx(
        styles.asmEventCard,
        isGray ? styles.asmCardGray : cx(styles.asmCardOpen, eventCategoryClass),
        {
          [styles.asmCardConflict]: ev.hasMentoringConflict,
          [styles.asmCardEnrolled]: ev.isEnrolled,
        },
      )}
      role="link"
      tabIndex={0}
      onClick={openLecture}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.asmCardBadges}>
        <span className={cx(styles.asmBadge, styles.asmCatBadge, eventCategoryClass)}>
          {ev.categoryNm}
        </span>

        {locInfo ? (
          <Badge className={locInfo.type === 'online' ? styles.asmOnline : styles.asmOffline}>
            {locInfo.label}
          </Badge>
        ) : ev.title.includes('[온라인]') || ev.title.includes('(온라인)') ? (
          <Badge className={styles.asmOnline}>온라인</Badge>
        ) : ev.title.includes('[오프라인]') || ev.title.includes('(오프라인)') ? (
          <Badge className={styles.asmOffline}>오프라인</Badge>
        ) : null}

        <Badge className={statusCls}>{statusLabel}</Badge>

        {ev.isEnrolled && <IconBadge icon="check" text="수강중" className={styles.asmEnrolled} />}

        {ev.hasMentoringConflict && (
          <Badge className={styles.asmConflict}>멘토링일정주의</Badge>
        )}
      </div>

      <div className={styles.asmCardTitle}>{ev.title}</div>

      <div className={styles.asmCardFooter}>
        {ev.author && <div className={styles.asmCardAuthor}>{ev.author} 멘토</div>}
        {ev.timeStart && (
          <div className={styles.asmCardTime}>
            {ev.timeStart} ~ {ev.timeEnd}
          </div>
        )}
        <div className={styles.asmCardFooterBottom}>
          {ev.current !== '' && ev.total !== '' ? (
            <span className={styles.asmCap}>
              {ev.current}/{ev.total}명
            </span>
          ) : (
            <span />
          )}
          <a
            className={styles.asmCardLink}
            href={safeUrl || '#'}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
          >
            바로가기 →
          </a>
        </div>
        {ev.timeStart && ev.timeEnd && ev.date && exporter && (
          <ExportSlot
            className={styles.asmCardExportRow}
            title={ev.title}
            description={exportDescription}
            location={ev.location || ''}
            startsAt={kstToIso(ev.date, ev.timeStart)}
            endsAt={kstToIso(ev.date, ev.timeEnd)}
            filenameBase={ev.title}
          />
        )}
      </div>
    </div>
  );
}
