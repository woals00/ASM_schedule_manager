// Fetch SOMA lecture detail page and extract mentor/location/people/status.

import { readChromeStorage, removeChromeStorage, writeChromeStorage } from '@shared/storage/storage';
import { isLectureEnded } from '@shared/date/date-time';
import { extractSomaDetailFields } from '@shared/soma/detail-page';
import type { LectureDetails } from './types';

const CACHE_KEY_PREFIX = 'soma_lecture_detail_';

export async function clearLectureDetailCache(): Promise<void> {
  const all = await new Promise<Record<string, unknown>>((resolve) => {
    chrome.storage.local.get(null, (res) => resolve(res || {}));
  });
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_KEY_PREFIX));
  if (keys.length === 0) return;
  await removeChromeStorage(keys);
}

// Stable lecture detail fields rarely change; keep a longer cache.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

interface CachedLectureDetail extends LectureDetails {
  dateTimeText: string;
  timestamp: number;
}

const UNKNOWN = '정보 없음';
const LOADING = '로딩 중...';

const PLACEHOLDER_DETAILS: LectureDetails = {
  mentorName: UNKNOWN,
  location: UNKNOWN,
  people: UNKNOWN,
  approvalStatus: UNKNOWN,
  deadlineStatus: UNKNOWN,
};

export function formatPeopleSummary(peopleText: string | undefined | null): string {
  const normalized = (peopleText || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === UNKNOWN || normalized === LOADING) return UNKNOWN;

  const slashMatch = normalized.match(/(\d+)\s*\/\s*(\d+)/);
  if (slashMatch) {
    return `${slashMatch[1]} / ${slashMatch[2]}`;
  }

  const numberMatches = normalized.match(/\d+/g);
  if (numberMatches && numberMatches.length >= 2) {
    return `${numberMatches[0]} / ${numberMatches[1]}`;
  }

  return normalized;
}

/**
 * 상세 페이지에서 신청자 수를 추출한다. 우선순위 폴백 3단계:
 * .total-normal 텍스트 → script 의 appCnt 변수 → [신청완료] 활성 행 개수.
 * @returns 신청자 수 문자열, 못 구하면 빈 문자열
 */
export function extractApplicantCount(doc: Document): string {
  const summaryText =
    doc.querySelector('.total-normal')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const summaryMatch = summaryText.match(/\[\s*(\d+)\s*명\s*\]/);
  if (summaryMatch) return summaryMatch[1];

  const scriptText = Array.from(doc.scripts).map((s) => s.textContent || '').join('\n');
  const appCountMatch = scriptText.match(/appCnt\s*:\s*"(\d+)"/);
  if (appCountMatch) return appCountMatch[1];

  const activeApplicants = Array.from(doc.querySelectorAll('.boardlist table tbody tr')).filter(
    (row) => !row.querySelector('.color-red') && (row.textContent || '').includes('[신청완료]')
  ).length;

  return activeApplicants > 0 ? String(activeApplicants) : '';
}

export function formatDeadlineStatus(
  rawStatus: string | undefined,
  approval: string | undefined,
  isEnded: boolean
): string {
  if (isEnded) return '마감';

  const normalizedStatus = (rawStatus || '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (normalizedStatus && normalizedStatus !== UNKNOWN && normalizedStatus !== LOADING) {
    if (/접수중|모집중/.test(normalizedStatus)) return '접수중';
    if (/마감|종료|불가|완료/.test(normalizedStatus)) return '마감';
    return normalizedStatus;
  }

  const combined = [rawStatus, approval].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!combined || combined === UNKNOWN || combined === LOADING) {
    return UNKNOWN;
  }

  if (/마감|종료|불가|완료/.test(combined)) return '마감';
  if (/진행|가능|접수중|모집중|승인/.test(combined)) return '진행중';
  return combined;
}

export function formatApprovalStatus(rawApproval: string | undefined): string {
  const normalized = (rawApproval || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === UNKNOWN || normalized === LOADING) {
    return UNKNOWN;
  }

  if (/승인|개설/.test(normalized) && !/미승인|승인대기|대기/.test(normalized)) {
    return '승인';
  }

  if (/대기/.test(normalized)) return '대기';
  if (/미승인|반려|취소/.test(normalized)) return '미승인';
  return normalized;
}

/**
 * 강의 상세를 페치(또는 캐시 반환)한다. 지난 강의는 무기한, 진행 중은 4시간 캐시.
 * url 이 없으면 즉시 placeholder. 신청자 수와 정원을 합쳐 "n / m" 형태로 정리한다.
 * @param dateTimeText 리스트 페이지 일시 — 지난 강의 판정(캐시 정책)과 폴백에 쓰인다
 */
export async function fetchLectureDetails(
  somaLectureId: string,
  url: string,
  dateTimeText: string
): Promise<LectureDetails> {
  if (!url) {
    return { ...PLACEHOLDER_DETAILS };
  }

  const cacheKey = `${CACHE_KEY_PREFIX}${somaLectureId}`;
  const stored = await readChromeStorage([cacheKey]);
  const cached = stored[cacheKey] as CachedLectureDetail | undefined;

  const isPast = isLectureEnded(dateTimeText);
  const now = Date.now();

  const hasDetailCacheShape =
    cached &&
    Object.prototype.hasOwnProperty.call(cached, 'approvalStatus') &&
    Object.prototype.hasOwnProperty.call(cached, 'lectureDateTimeText');

  if (cached && hasDetailCacheShape) {
    if (isPast || (cached.timestamp && now - cached.timestamp < CACHE_TTL_MS)) {
      return {
        mentorName: cached.mentorName || UNKNOWN,
        location: cached.location,
        people: cached.people,
        approvalStatus: cached.approvalStatus || UNKNOWN,
        deadlineStatus: cached.deadlineStatus || UNKNOWN,
        lectureDateTimeText: cached.lectureDateTimeText || '',
      };
    }
  }

  try {
    const absoluteUrl = url.startsWith('http')
      ? url
      : `${window.location.origin}${url.startsWith('/') ? url : '/' + url}`;
    const response = await fetch(absoluteUrl, { credentials: 'include' });
    if (!response.ok) throw new Error('Network error');
    const htmlText = await response.text();
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');

    const fields = extractSomaDetailFields(doc);
    let people = fields.people;

    const applicantCount = extractApplicantCount(doc);
    if (people && applicantCount) {
      const capacityMatch = people.match(/(\d+)/);
      if (capacityMatch) {
        people = `${applicantCount} / ${capacityMatch[1]}`;
      }
    }

    const finalDetails: LectureDetails = {
      mentorName: fields.mentorName || UNKNOWN,
      location: fields.location || UNKNOWN,
      people: people || UNKNOWN,
      approvalStatus: fields.approvalStatus || UNKNOWN,
      deadlineStatus: fields.deadlineStatus || UNKNOWN,
      lectureDateTimeText: fields.lectureDateTimeText,
    };

    const detailsToCache: CachedLectureDetail = {
      ...finalDetails,
      dateTimeText,
      timestamp: Date.now(),
    };

    try {
      await writeChromeStorage({ [cacheKey]: detailsToCache });
    } catch {
      /* ignore cache write failure */
    }

    return finalDetails;
  } catch (e) {
    console.error(`Failed to fetch details for lecture ${somaLectureId}:`, e);
    return { ...PLACEHOLDER_DETAILS };
  }
}
