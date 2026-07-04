// EventRecord assembly, search filter, and sort helpers for mentoLec list page.

import type { EventInfo } from './list-cache';
import { timeToMinutes } from '@shared/date/date-time';

export interface EventRecord extends EventInfo {
  somaLectureId: string | null;
  category: string;
  categoryNm: string;
  url: string;
  location?: string | null;
  hasMentoringConflict?: boolean;
  isEnrolled?: boolean;
}

export function normalizeText(text: string | undefined | null): string {
  return (text || '').toString().trim().normalize('NFC').toLowerCase();
}

/**
 * 달력 DOM 의 강의 셀과 캐시된 eventMap 을 합쳐 EventRecord 목록을 만든다.
 * 1차로 렌더된 DOM 셀에서 수집(중복 id 제거), 2차로 DOM 엔 없고 eventMap 에만 있는 강의를 보충한다.
 * DOM 은 현재 보이는 달만 담고 있어 캐시로 빈칸을 메우는 구조.
 * @param eventMap somaLectureId → 리스트 캐시 정보
 */
export function collectEvents(eventMap: Map<string, EventInfo>): EventRecord[] {
  const events: EventRecord[] = [];
  const seen = new Set<string>();

  document
    .querySelectorAll('.mypageCalendar .datepicker-days tbody td[data-date] ul li.category')
    .forEach((li) => {
      const td = li.closest('td[data-date]');
      const date = td ? td.getAttribute('data-date') : null;

      if (!date) return;

      const anchor = li.querySelector<HTMLAnchorElement>('a[title]');
      if (!anchor) return;

      const title = anchor.getAttribute('title') || '';
      const category = [...anchor.classList].find((c) => c.startsWith('MRC')) || '';
      const popLink = li.querySelector<HTMLAnchorElement>('.calendarPop a.link');
      const somaLectureIdMatch = popLink ? popLink.href.match(/qustnrSn=(\d+)/) : null;
      const somaLectureId = somaLectureIdMatch ? somaLectureIdMatch[1] : null;
      const url = popLink ? popLink.href : '#';

      if (somaLectureId && seen.has(somaLectureId)) return;
      if (somaLectureId) seen.add(somaLectureId);

      const info: Partial<EventInfo> = (somaLectureId && eventMap.get(somaLectureId)) || {};

      events.push({
        somaLectureId,
        date: info.date || date,
        title,
        category,
        categoryNm: category === 'MRC010' ? '자유 멘토링' : '멘토 특강',
        url,
        isClosed: info.isClosed ?? false,
        current: info.current || '',
        total: info.total || '',
        author: info.author || '',
        timeStart: info.timeStart || '',
        timeEnd: info.timeEnd || '',
      });
    });

  eventMap.forEach((info, somaLectureId) => {
    if (seen.has(somaLectureId) || !info.date) return;

    const link = document.querySelector<HTMLAnchorElement>(
      `a[href*="qustnrSn=${somaLectureId}"][href*="mentoLec/view"]`
    );
    const titleFromDom = link
      ? (link.textContent ?? '').trim().replace(/^\[(자유 멘토링|멘토 특강)\]\s*/, '')
      : '';

    const title = info.title || titleFromDom || `(번호 ${somaLectureId})`;
    const titleRaw = link ? (link.textContent ?? '').trim() : info.title || '';
    const category = titleRaw.startsWith('[자유 멘토링]') ? 'MRC010' : 'MRC020';
    const url = link
      ? link.href
      : `${location.origin}/busan/sw/mypage/mentoLec/view.do?qustnrSn=${somaLectureId}&menuNo=200046`;

    events.push({
      somaLectureId,
      date: info.date,
      title,
      category,
      categoryNm: category === 'MRC010' ? '자유 멘토링' : '멘토 특강',
      url,
      isClosed: info.isClosed,
      current: info.current,
      total: info.total,
      author: info.author,
      timeStart: info.timeStart,
      timeEnd: info.timeEnd,
    });
  });

  return events;
}

export function filterEventsBySearch(
  events: EventRecord[],
  searchType: 'title' | 'author',
  searchKeyword: string
): EventRecord[] {
  const keyword = normalizeText(searchKeyword);
  if (!keyword) return events;

  return events.filter((ev) => {
    const target = searchType === 'title' ? normalizeText(ev.title) : normalizeText(ev.author);
    return target.includes(keyword);
  });
}

function getEventStatusGroup(ev: EventRecord, todayStr: string): number {
  const isPast = ev.date < todayStr;
  const isClosed = ev.isClosed;
  return isPast || isClosed ? 1 : 0;
}

function getComparableAuthor(author: string): string {
  return (author || '').replace(/\s*멘토\s*$/g, '').trim().normalize('NFC');
}

function getComparableTitle(title: string): string {
  return (title || '')
    .replace(/^\s*\[(온라인|오프라인)\]\s*/g, '')
    .replace(/^\s*\((온라인|오프라인)\)\s*/g, '')
    .replace(/^\s*\[(자유 멘토링|멘토 특강)\]\s*/g, '')
    .trim()
    .normalize('NFC');
}

function compareKoreanText(aText: string, bText: string): number {
  return aText.localeCompare(bText, 'ko-KR', {
    usage: 'sort',
    sensitivity: 'variant',
    numeric: true,
    ignorePunctuation: true,
  });
}

export function sortEventsByStatusTimeAuthor(a: EventRecord, b: EventRecord, todayStr: string): number {
  const groupA = getEventStatusGroup(a, todayStr);
  const groupB = getEventStatusGroup(b, todayStr);

  if (groupA !== groupB) return groupA - groupB;

  const timeA = timeToMinutes(a.timeStart);
  const timeB = timeToMinutes(b.timeStart);

  if (timeA !== timeB) return timeA - timeB;

  const authorA = getComparableAuthor(a.author);
  const authorB = getComparableAuthor(b.author);

  const authorCompare = compareKoreanText(authorA, authorB);
  if (authorCompare !== 0) return authorCompare;

  const titleA = getComparableTitle(a.title);
  const titleB = getComparableTitle(b.title);

  const titleCompare = compareKoreanText(titleA, titleB);
  if (titleCompare !== 0) return titleCompare;

  return String(a.somaLectureId || '').localeCompare(String(b.somaLectureId || ''), 'ko-KR', { numeric: true });
}
