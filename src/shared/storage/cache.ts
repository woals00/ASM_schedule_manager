import { hasChromeLocalStorage, readChromeStorage, writeChromeStorage, removeChromeStorage } from '@shared/storage/storage';

export interface CacheEntry<T> {
  ts: number;
  data: Array<[string, T]>;
}

/**
 * chrome.storage 우선, 없으면 sessionStorage 폴백으로 캐시 엔트리를 읽는다.
 * sessionStorage 에서 읽었으면 chrome.storage 로 옮기고 sessionStorage 는 비운다(점진적 마이그레이션).
 * @returns 엔트리, 없거나 파싱 실패 시 null (TTL 검증은 cacheEntryToMap 담당)
 */
export async function readCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const result = await readChromeStorage([key]);
    if (result[key]) return result[key] as CacheEntry<T>;

    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (hasChromeLocalStorage()) {
      try {
        await writeChromeStorage({ [key]: entry });
        sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }

    return entry;
  } catch {
    return null;
  }
}

/**
 * chrome.storage 에 캐시 엔트리를 쓴다. chrome.storage 가 없으면 sessionStorage 로 폴백.
 * 모든 백엔드 쓰기가 실패해도 throw 하지 않고 조용히 무시한다.
 */
export async function writeCacheEntry<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  try {
    if (!hasChromeLocalStorage()) {
      throw new Error('chrome.storage.local is unavailable');
    }

    await writeChromeStorage({ [key]: entry });
    sessionStorage.removeItem(key);
  } catch {
    try {
      sessionStorage.setItem(key, JSON.stringify(entry));
    } catch {
      /* ignore */
    }
  }
}

export async function removeCacheEntries(keys: string[]): Promise<void> {
  keys.forEach((key) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  });

  await removeChromeStorage(keys);
}

export function cacheEntryToMap<T>(entry: CacheEntry<T> | null, ttl: number): Map<string, T> | null {
  if (!entry || !Array.isArray(entry.data)) return null;
  if (Date.now() - (entry.ts || 0) > ttl) return null;

  try {
    return new Map(entry.data);
  } catch {
    return null;
  }
}
