// List-page parsing, batched page fetch, and stable/count caches.

import {
  CacheEntry,
  readCacheEntry,
  writeCacheEntry,
  cacheEntryToMap,
} from '@shared/storage/cache';

export interface EventInfo {
  date: string;
  title: string;
  timeStart: string;
  timeEnd: string;
  current: string;
  total: string;
  isClosed: boolean;
  author: string;
}

export type CountInfo = { current: string; total: string };

export const STABLE_CACHE_KEY = 'asm_event_stable_v1';
export const COUNT_CACHE_KEY = 'asm_event_count_v1';
export const STABLE_CACHE_TTL = 4 * 60 * 60 * 1000;
export const COUNT_CACHE_TTL = 5 * 60 * 1000;

const LIST_FETCH_BATCH_SIZE = 3;
const FULL_FETCH_JITTER_MAX_MS = 10 * 1000;

/**
 * 강의 목록 테이블(tbody tr)을 파싱해 somaLectureId → EventInfo 맵으로 변환한다.
 * SOMA 의 td.pc_only 컬럼 순서(2 일시 / 3 정원 / 5 상태 / 6 작성자)에 의존 — 마크업이 바뀌면 깨진다.
 * 정규식 부분 매칭이 실패한 필드는 빈 문자열로 채운다.
 */
export function parseTableRows(root: Document | Element): Map<string, EventInfo> {
  const map = new Map<string, EventInfo>();

  root.querySelectorAll('tbody tr').forEach((tr) => {
    const link = tr.querySelector<HTMLAnchorElement>('a[href*="mentoLec/view.do"]');
    if (!link) return;

    const somaLectureIdMatch = link.href.match(/qustnrSn=(\d+)/);
    if (!somaLectureIdMatch) return;

    const somaLectureId = somaLectureIdMatch[1];

    const allTds = tr.querySelectorAll('td');
    const pcTds = [...allTds].filter((td) => td.classList.contains('pc_only'));

    const dateTimeRaw = pcTds[2] ? pcTds[2].textContent ?? '' : '';
    const dateMatch = dateTimeRaw.match(/(\d{4}-\d{2}-\d{2})/);
    const fullTimeMatch = dateTimeRaw.match(
      /(\d{4}-\d{2}-\d{2})(?:\([^)]+\))?\s+(\d{2}:\d{2})\s*시?\s*~\s*(\d{2}:\d{2})\s*시?/
    );

    const capRaw = pcTds[3] ? pcTds[3].textContent ?? '' : '';
    const capMatch = capRaw.match(/(\d+)\s*\/\s*(\d+)/);

    const statusRaw = pcTds[5] ? (pcTds[5].textContent ?? '').trim() : '';
    const author = pcTds[6] ? (pcTds[6].textContent ?? '').trim() : '';

    const titleRaw = (link.textContent ?? '').trim();
    const title = titleRaw.replace(/^\[(자유 멘토링|멘토 특강)\]\s*/, '');

    map.set(somaLectureId, {
      date: dateMatch ? dateMatch[1] : '',
      title,
      timeStart: fullTimeMatch ? fullTimeMatch[2] : '',
      timeEnd: fullTimeMatch ? fullTimeMatch[3] : '',
      current: capMatch ? capMatch[1] : '',
      total: capMatch ? capMatch[2] : '',
      isClosed: statusRaw.includes('마감'),
      author,
    });
  });

  return map;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitBeforeFullFetch(): Promise<void> {
  const jitter = Math.floor(Math.random() * FULL_FETCH_JITTER_MAX_MS);
  if (jitter > 0) await delay(jitter);
}

/**
 * 작업들을 batchSize 단위로 끊어 순차 실행한다(배치 내부는 병렬).
 * Promise.allSettled 라서 한 작업이 실패해도 다음 배치를 막지 않는다.
 * @param onBatch 각 배치 완료마다 호출 — 부분 결과를 즉시 UI 에 반영하는 용도
 * @returns 모든 작업의 settled 결과(호출자가 fulfilled/rejected 를 직접 거른다)
 */
export async function fetchInBatches<T>(
  tasks: Array<() => Promise<T>>,
  batchSize: number,
  onBatch?: (batchResults: PromiseSettledResult<T>[]) => void
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map((fn) => fn()));
    results.push(...batchResults);
    if (onBatch) onBatch(batchResults);
  }
  return results;
}

export async function loadStableCache(): Promise<Map<string, EventInfo> | null> {
  return cacheEntryToMap<EventInfo>(await readCacheEntry<EventInfo>(STABLE_CACHE_KEY), STABLE_CACHE_TTL);
}

async function saveStableCache(map: Map<string, EventInfo>): Promise<void> {
  const stableOnly = new Map<string, EventInfo>(
    [...map].map(([k, v]) => [
      k,
      {
        date: v.date,
        title: v.title,
        timeStart: v.timeStart,
        timeEnd: v.timeEnd,
        isClosed: v.isClosed,
        author: v.author,
        current: '',
        total: '',
      },
    ])
  );

  const entry: CacheEntry<EventInfo> = { ts: Date.now(), data: [...stableOnly] };
  await writeCacheEntry<EventInfo>(STABLE_CACHE_KEY, entry);
}

export async function loadCountCache(): Promise<Map<string, CountInfo> | null> {
  return cacheEntryToMap<CountInfo>(await readCacheEntry<CountInfo>(COUNT_CACHE_KEY), COUNT_CACHE_TTL);
}

async function saveCountCache(map: Map<string, EventInfo>): Promise<void> {
  const countsOnly = new Map<string, CountInfo>(
    [...map].map(([k, v]) => [k, { current: v.current, total: v.total }])
  );

  const entry: CacheEntry<CountInfo> = { ts: Date.now(), data: [...countsOnly] };
  await writeCacheEntry<CountInfo>(COUNT_CACHE_KEY, entry);
}

function mergeStableAndCounts(
  stableMap: Map<string, EventInfo>,
  countMap: Map<string, CountInfo> | null
): Map<string, EventInfo> {
  const merged = new Map<string, EventInfo>();
  stableMap.forEach((v, somaLectureId) => {
    const counts = countMap?.get(somaLectureId);
    merged.set(somaLectureId, {
      ...v,
      current: counts?.current ?? v.current ?? '',
      total: counts?.total ?? v.total ?? '',
    });
  });
  return merged;
}

async function fetchPageMap(pageIndex: number, baseUrl: string): Promise<Map<string, EventInfo>> {
  const url = `${baseUrl}&scdate=2026-01-01&ecdate=2026-12-31&edcDateOrder=&regDateOrder=&pageIndex=${pageIndex}`;
  const res = await fetch(url, { credentials: 'include' });

  if (!res.ok) return new Map();

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  return parseTableRows(doc);
}

export function getBaseUrl(): string {
  const u = new URL(location.href);
  return `${u.origin}${u.pathname}?menuNo=${u.searchParams.get('menuNo') || '200046'}`;
}

export function getTotalPages(): number {
  const lastLink = document.querySelector<HTMLAnchorElement>(
    '.paginationSet a[title="마지막 목록"], .paginationSet .i.last a'
  );

  if (lastLink) {
    const m = lastLink.href.match(/pageIndex=(\d+)/);
    if (m) return parseInt(m[1], 10);
  }

  const pageLinks = document.querySelectorAll<HTMLAnchorElement>('.paginationSet li a');
  let max = 1;

  pageLinks.forEach((a) => {
    const m = a.href.match(/pageIndex=(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });

  return max;
}

/**
 * 리스트 전체 강의 맵을 구성한다 — 캐시 우선, 없으면 전체 페이지를 페치.
 * stable·count 캐시가 둘 다 살아있으면 페치 없이 병합만 해서 반환한다.
 * 가변 정원(count, TTL 5분)과 거의 안 바뀌는 본문(stable, TTL 4시간)을 분리 캐시한다.
 * @param onProgress 배치마다·완료 시 호출 — 강의가 점진적으로 렌더되도록
 */
export async function buildCompleteEventMap(
  onProgress?: (map: Map<string, EventInfo>) => void
): Promise<Map<string, EventInfo>> {
  const stableCache = await loadStableCache();
  const countCache = await loadCountCache();

  if (stableCache && countCache) {
    return mergeStableAndCounts(stableCache, countCache);
  }

  const freshMap = parseTableRows(document);
  const totalPages = getTotalPages();
  const baseUrl = getBaseUrl();

  if (totalPages > 1) {
    await waitBeforeFullFetch();

    const pageNums: number[] = [];
    for (let i = 2; i <= totalPages; i++) pageNums.push(i);

    await fetchInBatches<Map<string, EventInfo>>(
      pageNums.map((n) => () => fetchPageMap(n, baseUrl)),
      LIST_FETCH_BATCH_SIZE,
      (batchResults) => {
        batchResults.forEach((r) => {
          if (r.status === 'fulfilled') {
            r.value.forEach((v, k) => {
              if (!freshMap.has(k)) freshMap.set(k, v);
            });
          }
        });
        // Surface each finished batch so already-fetched lectures render
        // incrementally instead of all appearing once the full fetch ends.
        if (onProgress) onProgress(freshMap);
      }
    );
  }

  await saveCountCache(freshMap);

  if (!stableCache) await saveStableCache(freshMap);

  if (onProgress) onProgress(freshMap);

  return mergeStableAndCounts(
    stableCache ?? freshMap,
    new Map<string, CountInfo>([...freshMap].map(([k, v]) => [k, { current: v.current, total: v.total }]))
  );
}
