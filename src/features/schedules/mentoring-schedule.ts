import { readChromeStorage, writeChromeStorage } from '@shared/storage/storage';
import { parseLectureDateTimeText } from '@shared/date/date-time';

export interface MentoringSchedule {
  somaLectureId: string;
  title: string;
  dateStr: string;
  startTime: string;
  endTime: string;
}

const MENTORING_CACHE_TTL = 5 * 60 * 1000;

interface StoredMentoring {
  soma_mentoring_schedules?: MentoringSchedule[];
  soma_mentoring_schedules_ts?: number;
}

export async function loadStoredMentoringSchedules(): Promise<MentoringSchedule[]> {
  const res = (await readChromeStorage([
    'soma_mentoring_schedules',
    'soma_mentoring_schedules_ts',
  ])) as StoredMentoring;
  return Array.isArray(res.soma_mentoring_schedules) ? res.soma_mentoring_schedules : [];
}

export async function saveMentoringSchedules(schedules: MentoringSchedule[]): Promise<void> {
  await writeChromeStorage({
    soma_mentoring_schedules: schedules,
    soma_mentoring_schedules_ts: Date.now(),
  });
}

function getRegistrationHistoryUrls(): string[] {
  const origin = location.origin;
  const baseMatch = location.pathname.match(/^(.*?\/sw)\//);
  const bases = new Set<string>();
  if (baseMatch) bases.add(baseMatch[1]);
  bases.add('/busan/sw');
  bases.add('/sw');
  return [...bases].map((base) => `${origin}${base}/mypage/userAnswer/history.do?menuNo=200047`);
}

function normalizeCellHtml(cell: Element): string {
  return cell.innerHTML
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMentorDeletedRow(cells: NodeListOf<HTMLTableCellElement>): boolean {
  for (let i = 8; i < cells.length; i++) {
    const cellText = (cells[i].textContent || '').replace(/\s+/g, ' ').trim();
    const hasInteractive = cells[i].querySelector('button, a, [onclick]');
    if (!hasInteractive && /^삭제/.test(cellText)) return true;
  }
  return false;
}

function collectPageIndexes(doc: Document): Set<number> {
  const indexes = new Set<number>();
  const pagingEl = doc.querySelector('.paging, .pagination, [class*="paging"]');
  if (!pagingEl) return indexes;

  pagingEl.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const onclick = link.getAttribute('onclick') || '';

    const fromHref = href.match(/pageIndex=(\d+)/);
    if (fromHref) indexes.add(parseInt(fromHref[1], 10));

    const fromOnclick = onclick.match(/\((\d+)\)/);
    if (fromOnclick) indexes.add(parseInt(fromOnclick[1], 10));
  });

  return indexes;
}

/**
 * 신청내역 페이지 문서에서 유효한 멘토링 일정만 뽑아낸다.
 * 제외: 멘토 삭제 행, "취소" 상태(단 "취소불가"는 정상으로 유지), id·일시 파싱 실패 행.
 */
function extractSchedulesFromRegistrationHistoryDoc(doc: Document): MentoringSchedule[] {
  const schedules: MentoringSchedule[] = [];
  const rows = doc.querySelectorAll('.boardlist table tbody tr');

  rows.forEach((tr) => {
    const cells = tr.querySelectorAll<HTMLTableCellElement>('td');
    if (cells.length < 8) return;
    if (isMentorDeletedRow(cells)) return;

    const status = (cells[6].textContent ?? '').trim();
    const approval = (cells[7].textContent ?? '').trim();
    const combined = `${status} ${approval}`;
    if (/취소/.test(combined) && !/취소불가/.test(combined)) return;

    const titleLink = cells[2].querySelector<HTMLAnchorElement>('a');
    const href = titleLink ? titleLink.getAttribute('href') ?? '' : '';
    const somaLectureId = href.match(/[?&]qustnrSn=(\d+)/)?.[1] ?? '';
    if (!somaLectureId) return;

    const parsed = parseLectureDateTimeText(normalizeCellHtml(cells[4]));
    if (!parsed) return;

    schedules.push({
      somaLectureId,
      title: titleLink ? (titleLink.textContent ?? '').trim() : '',
      dateStr: `${parsed.y}-${parsed.m}-${parsed.d}`,
      startTime: `${parsed.sh}:${parsed.sm}`,
      endTime: `${parsed.eh}:${parsed.em}`,
    });
  });

  return schedules;
}

async function fetchRegistrationHistoryDoc(url: string): Promise<Document | null> {
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return null;
    const html = await resp.text();
    return new DOMParser().parseFromString(html, 'text/html');
  } catch (error) {
    console.warn('SOMA Schedule Manager: Failed to fetch registration history schedules:', error);
    return null;
  }
}

function dedupeSchedules(schedules: MentoringSchedule[]): MentoringSchedule[] {
  const seen = new Set<string>();
  return schedules.filter((schedule) => {
    const key = schedule.somaLectureId || `${schedule.title}:${schedule.dateStr}:${schedule.startTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchMentoringSchedulesFromRegistrationHistoryUrl(url: string): Promise<MentoringSchedule[] | null> {
  const firstDoc = await fetchRegistrationHistoryDoc(url);
  if (!firstDoc) return null;

  const schedules = [...extractSchedulesFromRegistrationHistoryDoc(firstDoc)];
  const seenIndexes = new Set<number>([
    parseInt(new URL(url).searchParams.get('pageIndex') || '1', 10),
  ]);
  const pendingIndexes = new Set<number>(collectPageIndexes(firstDoc));

  for (const idx of pendingIndexes) {
    if (seenIndexes.has(idx)) continue;
    seenIndexes.add(idx);

    const pageUrl = new URL(url);
    pageUrl.searchParams.set('pageIndex', String(idx));
    const pageDoc = await fetchRegistrationHistoryDoc(pageUrl.toString());
    if (!pageDoc) continue;

    schedules.push(...extractSchedulesFromRegistrationHistoryDoc(pageDoc));
    for (const nextIdx of collectPageIndexes(pageDoc)) {
      if (!seenIndexes.has(nextIdx)) pendingIndexes.add(nextIdx);
    }
  }

  return dedupeSchedules(schedules);
}

export async function fetchMentoringSchedulesFromRegistrationHistory(): Promise<MentoringSchedule[]> {
  const urls = getRegistrationHistoryUrls();

  for (const url of urls) {
    const schedules = await fetchMentoringSchedulesFromRegistrationHistoryUrl(url);
    if (schedules === null) continue;
    await saveMentoringSchedules(schedules);
    return schedules;
  }

  return [];
}

export async function loadMentoringSchedules(): Promise<MentoringSchedule[]> {
  const res = (await readChromeStorage([
    'soma_mentoring_schedules',
    'soma_mentoring_schedules_ts',
  ])) as StoredMentoring;

  const ts = res.soma_mentoring_schedules_ts || 0;
  const cached = res.soma_mentoring_schedules;

  if (Array.isArray(cached) && cached.length > 0 && Date.now() - ts < MENTORING_CACHE_TTL) {
    return cached;
  }

  return fetchMentoringSchedulesFromRegistrationHistory();
}
