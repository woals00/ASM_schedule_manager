// SOMA mentoLec board enhancement — orchestrator. State (month offset,
// search, collapsed, refresh, loadingMessage, selectedDate, infoOpen,
// loc-cache version) lives here; the header / search row / info popover /
// event grid / day events are split into their own files.
//
// Mounted once inside a Shadow DOM; CSS module text is bundled here for
// boundary injection while components keep their own module class exports.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  STABLE_CACHE_KEY,
  COUNT_CACHE_KEY,
  buildCompleteEventMap,
  loadCountCache,
  loadStableCache,
  parseTableRows,
} from './list-cache';
import {
  LOC_CACHE_KEY,
  clearLocCacheMemory,
  fetchLocations,
  getLocCacheMemory,
  loadLocCache,
} from './loc-cache';
import {
  collectEvents,
  filterEventsBySearch,
  sortEventsByStatusTimeAuthor,
  type EventRecord,
} from './events';
import { getMonthRange, toDateStr } from '@shared/date/date-time';
import { removeCacheEntries } from '@shared/storage/cache';
import { removeChromeStorage } from '@shared/storage/storage';
import {
  loadMentoringSchedules,
  type MentoringSchedule,
} from '@features/schedules/mentoring-schedule';
import { hasMentoringScheduleConflict } from '@features/schedules/conflict';
import { Icon } from '@shared/ui/Icon';
import { cx } from '@shared/ui/cx';
import { SearchRow, searchRowCss, type SearchState } from './SearchRow';
import { InfoPopover, infoPopoverCss } from './InfoPopover';
import { DayEventPanel, dayEventPanelCss } from './DayEventPanel';
import { MentoLecCalendarGrid } from './MentoLecCalendarGrid';
import { eventCardCss } from './EventCard';
import styles from './MentoLecPanel.module.css';
import css from './MentoLecPanel.module.css?inline';

const ENROLLMENT_LOADING_MESSAGE = '수강중·겹침 표시 확인 중…';
const LIST_STATUS_LOADING_MESSAGE = '정원·마감 불러오는 중…';
export const mentoLecPanelCss = [
  css,
  infoPopoverCss,
  searchRowCss,
  dayEventPanelCss,
  eventCardCss,
].join('\n');

function locMessage(done: number, total: number): string {
  return `장소 정보 가져오는 중… (${done}/${total})`;
}

/**
 * EventRecord 에 멘토링 충돌 플래그와 수강 여부를 채우고, 캐시에 있으면 location 도 붙인다.
 * location 은 캐시 히트일 때만 포함 — 누락은 "장소 없음"이 아니라 "아직 미조회"를 뜻한다.
 */
function enrichEvent(
  ev: EventRecord,
  locCache: Map<string, string>,
  mentoringSchedules: MentoringSchedule[],
): EventRecord {
  const hasMentoringConflict = hasMentoringScheduleConflict(ev, mentoringSchedules);
  const isEnrolled = ev.somaLectureId
    ? mentoringSchedules.some((ms) => ms.somaLectureId === ev.somaLectureId)
    : false;
  if (ev.somaLectureId && locCache.has(ev.somaLectureId)) {
    return {
      ...ev,
      location: locCache.get(ev.somaLectureId) || null,
      hasMentoringConflict,
      isEnrolled,
    };
  }
  return { ...ev, hasMentoringConflict, isEnrolled };
}

export function MentoLecPanel() {
  const [currentOffset, setCurrentOffset] = useState(0);
  const [allEvents, setAllEvents] = useState<EventRecord[]>([]);
  const [mentoringSchedules, setMentoringSchedules] = useState<MentoringSchedule[]>([]);

  const [searchDraft, setSearchDraft] = useState<SearchState>({ type: 'title', keyword: '' });
  const [appliedSearch, setAppliedSearch] = useState<SearchState>({
    type: 'title',
    keyword: '',
  });

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [listLoadingMessage, setListLoadingMessage] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [locVersion, setLocVersion] = useState(0);
  const [searchFocusVersion, setSearchFocusVersion] = useState(0);

  const lastFetchedOffsetRef = useRef<number | null>(null);

  // ── Initial mount ──
  useEffect(() => {
    void (async () => {
      const [, stableCache, countCache] = await Promise.all([
        loadLocCache(),
        loadStableCache(),
        loadCountCache(),
      ]);
      setLoadingMessage(ENROLLMENT_LOADING_MESSAGE);
      const ms = await loadMentoringSchedules();
      setMentoringSchedules(ms);
      setLoadingMessage(null);

      const initialMap = parseTableRows(document);
      setAllEvents(collectEvents(initialMap));
      const needsListStatusFetch = !(stableCache && countCache);
      if (needsListStatusFetch) {
        setListLoadingMessage(LIST_STATUS_LOADING_MESSAGE);
      }

      try {
        const completeMap = await buildCompleteEventMap((partialMap) => {
          setAllEvents(collectEvents(partialMap));
        });
        setAllEvents(collectEvents(completeMap));
      } finally {
        if (needsListStatusFetch) setListLoadingMessage(null);
      }
      // Location fetch is kicked off by the effect that depends on allEvents+offset
    })();
  }, []);

  // ── Range / filter ──
  const monthRange = useMemo(() => getMonthRange(currentOffset), [currentOffset]);
  const todayStr = useMemo(() => toDateStr(monthRange.today), [monthRange.today]);
  const startDateStr = useMemo(() => toDateStr(monthRange.start), [monthRange.start]);
  const endDateStr = useMemo(() => toDateStr(monthRange.end), [monthRange.end]);
  const defaultSelectedDate = currentOffset === 0 ? todayStr : startDateStr;

  const monthEvents = useMemo(
    () =>
      allEvents.filter((ev) => ev.date >= startDateStr && ev.date <= endDateStr),
    [allEvents, startDateStr, endDateStr],
  );

  // Used only as filter input — location enrichment is applied below.
  const filteredEvents = useMemo(
    () => filterEventsBySearch(monthEvents, appliedSearch.type, appliedSearch.keyword),
    [monthEvents, appliedSearch],
  );

  // locVersion is bumped by fetchLocations progress; it forces this memo
  // to re-evaluate the (non-React) locCacheMemory map.
  const enrichedFiltered = useMemo(() => {
    const cache = getLocCacheMemory();
    return filteredEvents.map((ev) =>
      enrichEvent(ev, cache, mentoringSchedules),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents, mentoringSchedules, locVersion]);

  const byDate = useMemo(() => {
    const map = new Map<string, EventRecord[]>();
    for (let d = new Date(monthRange.start); d <= monthRange.end; d.setDate(d.getDate() + 1)) {
      map.set(toDateStr(new Date(d)), []);
    }
    enrichedFiltered.forEach((ev) => {
      const list = map.get(ev.date);
      if (list) list.push(ev);
    });
    return map;
  }, [enrichedFiltered, monthRange.start, monthRange.end]);

  // ── Auto-select default date on month change ──
  useEffect(() => {
    setSelectedDate(defaultSelectedDate);
  }, [defaultSelectedDate]);

  // ── Location fetch on offset / event-set change ──
  useEffect(() => {
    if (isRefreshing) return;
    if (allEvents.length === 0) return;
    if (lastFetchedOffsetRef.current === currentOffset) return;
    lastFetchedOffsetRef.current = currentOffset;

    void (async () => {
      setLoadingMessage('장소 정보 가져오는 중…');
      try {
        await fetchLocations(monthEvents, (done, total) => {
          setLoadingMessage(locMessage(done, total));
          setLocVersion((v) => v + 1);
        });
      } finally {
        setLoadingMessage(null);
        setLocVersion((v) => v + 1);
      }
    })();
  }, [currentOffset, allEvents, monthEvents, isRefreshing]);

  // ── Handlers ──
  const handleNavigate = useCallback((next: number) => {
    setCurrentOffset(next);
  }, []);

  const handleSearchChange = useCallback((next: SearchState) => {
    setSearchDraft(next);
  }, []);

  const handleSearchSubmit = useCallback((next: SearchState) => {
    setSearchDraft(next);
    setAppliedSearch(next);
    setSearchFocusVersion((v) => v + 1);
  }, []);

  const handleSearchReset = useCallback(() => {
    const reset: SearchState = { type: 'title', keyword: '' };
    setSearchDraft(reset);
    setAppliedSearch(reset);
    setSearchFocusVersion((v) => v + 1);
  }, []);

  const handleToggleCollapsed = useCallback(() => {
    setIsCollapsed((v) => !v);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setLoadingMessage('강의 목록 동기화 중…');
    try {
      await removeCacheEntries([STABLE_CACHE_KEY, COUNT_CACHE_KEY, LOC_CACHE_KEY]);
      clearLocCacheMemory();
      await removeChromeStorage(['soma_mentoring_schedules', 'soma_mentoring_schedules_ts']);

      setLoadingMessage(ENROLLMENT_LOADING_MESSAGE);
      const ms = await loadMentoringSchedules();
      setMentoringSchedules(ms);

      setLoadingMessage(null);
      setListLoadingMessage(LIST_STATUS_LOADING_MESSAGE);
      const completeMap = await buildCompleteEventMap((partialMap) => {
        setAllEvents(collectEvents(partialMap));
      });
      setListLoadingMessage(null);
      const fresh = collectEvents(completeMap);
      setAllEvents(fresh);

      setLoadingMessage('장소 정보 가져오는 중…');
      // After a full refresh the loc cache was wiped, so re-fetch unconditionally.
      lastFetchedOffsetRef.current = null;
      await fetchLocations(
        fresh.filter((ev) => ev.date >= startDateStr && ev.date <= endDateStr),
        (done, total) => {
          setLoadingMessage(locMessage(done, total));
          setLocVersion((v) => v + 1);
        },
      );
    } finally {
      // Tag the just-fetched offset so the auto-fetch effect doesn't re-run
      // for this same month when isRefreshing flips back to false.
      lastFetchedOffsetRef.current = currentOffset;
      setIsRefreshing(false);
      setLoadingMessage(null);
      setListLoadingMessage(null);
      setLocVersion((v) => v + 1);
    }
  }, [isRefreshing, currentOffset, startDateStr, endDateStr]);

  // ── Derived values for render ──
  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return null;
    const dayEvents = byDate.get(selectedDate) || [];
    return [...dayEvents].sort((a, b) => sortEventsByStatusTimeAuthor(a, b, todayStr));
  }, [selectedDate, byDate, todayStr]);

  const bodyStyle: CSSProperties = isCollapsed ? { display: 'none' } : {};
  const headerLoadingMessage = listLoadingMessage || loadingMessage;

  // ── Render ──
  return (
    <div id="asm-2week-panel">
      <div className={styles.asmPanelHeader}>
        <div className={styles.asmPanelTitleWrap}>
          <span className={styles.asmPanelIco}>
            <Icon name="calendar" size={16} />
          </span>
          <span className={styles.asmPanelTitle}>
            {monthRange.year}년 {monthRange.month + 1}월
          </span>
        </div>

        <div className={styles.asmPanelNav}>
          <button
            type="button"
            className={styles.asmPanelNavBtn}
            title="이전 달"
            onClick={() => handleNavigate(currentOffset - 1)}
          >
            ‹ 이전 달
          </button>
          <button
            type="button"
            className={cx(styles.asmPanelNavBtn, styles.asmNavToday, {
              [styles.asmNavTodayCurrent]: currentOffset === 0,
            })}
            title="오늘이 포함된 달로 이동"
            onClick={() => handleNavigate(0)}
          >
            오늘
          </button>
          <button
            type="button"
            className={styles.asmPanelNavBtn}
            title="다음 달"
            onClick={() => handleNavigate(currentOffset + 1)}
          >
            다음 달 ›
          </button>
        </div>

        <div className={styles.asmPanelActions}>
          <InfoPopover
            open={infoOpen}
            onToggle={() => setInfoOpen((v) => !v)}
            onClose={() => setInfoOpen(false)}
          />

          <span className={styles.asmPanelLoading} id="asm-panel-loading" aria-live="polite">
            {headerLoadingMessage && (
              <>
                <span className={styles.asmLoadingSpinner} />
                <span>{headerLoadingMessage}</span>
              </>
            )}
          </span>

          <button
            type="button"
            className={styles.asmPanelRefresh}
            title="새로고침"
            disabled={isRefreshing}
            onClick={(e) => {
              e.preventDefault();
              void handleRefresh();
            }}
          >
            <span
              className={cx(styles.asmRefreshIcon, {
                [styles.asmRefreshIconSpinning]: isRefreshing,
              })}
            >
              ↻
            </span>
          </button>

          <button
            type="button"
            className={styles.asmPanelToggle}
            onClick={(e) => {
              e.preventDefault();
              handleToggleCollapsed();
            }}
          >
            {isCollapsed ? '펼치기' : '접기'}
          </button>
        </div>
      </div>

      <div className={styles.asmPanelBody} style={bodyStyle}>
        <div className={styles.asmCalArea}>
          <SearchRow
            draft={searchDraft}
            focusVersion={searchFocusVersion}
            onChange={handleSearchChange}
            onSubmit={handleSearchSubmit}
            onReset={handleSearchReset}
          />

          <MentoLecCalendarGrid
            byDate={byDate}
            todayStr={todayStr}
            selectedDate={selectedDate}
            leadingEmptyCount={monthRange.start.getDay()}
            onSelectDate={(dateStr) =>
              setSelectedDate((cur) => (cur === dateStr ? null : dateStr))
            }
          />

          <div className={styles.asmCalendarNotice}>
            <div className={styles.asmCalendarNoticeTitle}>
              내가 신청한 멘토링 내역이 반영되지 않았다면?
            </div>
            <div className={styles.asmCalendarNoticeBody}>
              접수 내역 페이지에 한 번 들렀다 오면 자동으로 반영됩니다.
            </div>
          </div>
        </div>

        <div className={styles.asmEventPanel}>
          {selectedDate && selectedDayEvents ? (
            <DayEventPanel
              dateStr={selectedDate}
              dayEvents={selectedDayEvents}
              todayStr={todayStr}
              loadingMessage={headerLoadingMessage}
            />
          ) : headerLoadingMessage ? (
            <div className={styles.asmEventPanelPlaceholder}>
              <span className={styles.asmLoadingSpinner} />
              <span>{headerLoadingMessage}</span>
            </div>
          ) : (
            <div className={styles.asmEventPanelPlaceholder}>
              <span>
                날짜를 선택하면
                <br />
                일정이 표시됩니다
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
