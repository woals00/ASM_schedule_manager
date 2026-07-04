// Lecture detail-page location cache for mentoLec list events.

import { CacheEntry, readCacheEntry, writeCacheEntry, cacheEntryToMap } from '@shared/storage/cache';
import { toDateStr } from '@shared/date/date-time';
import { extractSomaDetailFields } from '@shared/soma/detail-page';
import { fetchInBatches } from './list-cache';

export const LOC_CACHE_KEY = 'asm_location_v1';
const LOC_CACHE_TTL = 4 * 60 * 60 * 1000;

let locCacheMemory = new Map<string, string>();

export function getLocCacheMemory(): Map<string, string> {
  return locCacheMemory;
}

export function clearLocCacheMemory(): void {
  locCacheMemory = new Map();
}

export async function loadLocCache(): Promise<Map<string, string>> {
  locCacheMemory =
    cacheEntryToMap<string>(await readCacheEntry<string>(LOC_CACHE_KEY), LOC_CACHE_TTL) ||
    new Map<string, string>();
  return locCacheMemory;
}

async function saveLocCache(map: Map<string, string>): Promise<void> {
  locCacheMemory = map;
  const entry: CacheEntry<string> = { ts: Date.now(), data: [...map] };
  await writeCacheEntry<string>(LOC_CACHE_KEY, entry);
}

/**
 * 강의 상세 문서에서 장소를 추출한다. 공유 detail 파서를 먼저 쓰고,
 * 그게 못 잡는 list-page 변형 마크업만 .label/.tit/strong 폴백으로 처리한다.
 * @returns 장소 문자열, 못 찾으면 null
 */
export function parseLocationFromDoc(doc: Document): string | null {
  const location = extractSomaDetailFields(doc).location;
  if (location) return location;

  // Selector family the shared detail reader doesn't cover (list-page variants).
  for (const el of doc.querySelectorAll('.label, .tit, strong')) {
    if ((el.textContent ?? '').trim() === '장소') {
      const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
      if (next) return (next.textContent ?? '').trim();
    }
  }

  return null;
}

/**
 * 강의들의 상세 페이지에서 장소를 배치(3개씩) 조회해 캐시에 채운다.
 * 캐시에 없고 오늘 이후인 강의만 대상 — 지난 강의·이미 캐시된 건 건너뛴다.
 * @param onProgress (완료 수, 전체 수) 진행률 콜백
 */
export async function fetchLocations(
  events: Array<{ somaLectureId: string | null; date: string }>,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string>> {
  const locCache = await loadLocCache();
  const todayStr = toDateStr(new Date());

  // ascending sort: today comes first (past is filtered out), then future days in order.
  // 월 이동 시에도 자동으로 그 달의 1일부터 순서대로 fetch됨.
  const missing = events
    .filter((ev) => ev.somaLectureId && !locCache.has(ev.somaLectureId) && ev.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (missing.length === 0) return locCache;

  const origin = location.origin;
  const total = missing.length;
  let done = 0;

  await fetchInBatches<{ somaLectureId: string | null; loc: string | null }>(
    missing.map((ev) => async () => {
      const url = `${origin}/busan/sw/mypage/mentoLec/view.do?qustnrSn=${ev.somaLectureId}&menuNo=200046`;
      const res = await fetch(url, { credentials: 'include' });

      if (!res.ok) return { somaLectureId: ev.somaLectureId, loc: null };

      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      return { somaLectureId: ev.somaLectureId, loc: parseLocationFromDoc(doc) };
    }),
    3,
    (batchResults) => {
      batchResults.forEach((r) => {
        if (r.status === 'fulfilled' && r.value.somaLectureId) {
          locCache.set(r.value.somaLectureId, r.value.loc ?? '');
        }
      });
      done += batchResults.length;
      if (onProgress) onProgress(done, total);
    }
  );

  await saveLocCache(locCache);

  return locCache;
}
