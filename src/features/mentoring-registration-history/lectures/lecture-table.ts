// Parse SOMA mentoring registration history list, fetch additional pages, merge details.

import { isLectureEnded } from '@shared/date/date-time';
import {
  fetchLectureDetails,
  formatApprovalStatus,
  formatDeadlineStatus,
  formatPeopleSummary,
} from './lecture-detail';
import type { Lecture, LectureDetails, RawLectureRow } from './types';

// Rows without a detail URL (e.g. lectures the mentor deleted from the catalog,
// which lose their title link) can't be fetched — render placeholders instead of
// a card stuck on "로딩 중...".
const NO_DETAILS: LectureDetails = {
  mentorName: '정보 없음',
  location: '정보 없음',
  people: '정보 없음',
  approvalStatus: '정보 없음',
  deadlineStatus: '정보 없음',
};

/**
 * 신청내역 테이블에서 원본 행들을 추출한다.
 * @param isCurrentPage 현재 화면 페이지면 취소 버튼(delDate) 존재 여부를 감지한다.
 *   페치해 온 다른 페이지엔 라이브 취소 버튼이 없으므로 false 로 둔다.
 */
export function extractRawRowsFromDoc(doc: Document, isCurrentPage: boolean): RawLectureRow[] {
  const rows = doc.querySelectorAll('.boardlist table tbody tr');
  const rawList: RawLectureRow[] = [];

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) continue;

    const no = (cells[0].textContent || '').trim();
    const type = (cells[1].textContent || '').trim();

    const titleLink = cells[2].querySelector<HTMLAnchorElement>('a');
    const title = titleLink ? (titleLink.textContent || '').trim() : (cells[2].textContent || '').trim();
    const url = titleLink ? titleLink.getAttribute('href') || '' : '';

    let somaLectureId = '';
    if (url) {
      const match = url.match(/[?&]qustnrSn=(\d+)/);
      if (match) somaLectureId = match[1];
    }

    const author = (cells[3].textContent || '').trim();
    const dateTimeText = cells[4].innerHTML
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const dateMatch = dateTimeText.match(/(\d{4})-(\d{2})-(\d{2})/);
    const dateStr = dateMatch ? dateMatch[0] : '';

    const registerDate = (cells[5].textContent || '').trim().replace(/\s+/g, ' ');
    const status = (cells[6].textContent || '').trim();
    const approval = (cells[7].textContent || '').trim();

    // SOMA renders the cancel link as <a href="javascript:delDate(...)"> only on
    // rows it considers cancelable. Detect it on the current page only — cancelling
    // requires clicking that live-DOM link (see triggerCancellation), which can't
    // reach rows fetched from other pages.
    const hasCancelButton = isCurrentPage
      ? !!row.querySelector('a[href*="delDate"], a[onclick*="delDate"]')
      : false;

    // Mentor-deleted lectures show plain "삭제" text in a trailing action cell
    // (no button/anchor) — distinct from the user's own delDate cancel button.
    let mentorDeleted = false;
    for (let i = 8; i < cells.length; i++) {
      const cellText = (cells[i].textContent || '').replace(/\s+/g, ' ').trim();
      const hasInteractive = cells[i].querySelector('button, a, [onclick]');
      if (!hasInteractive && /^삭제/.test(cellText)) {
        mentorDeleted = true;
        break;
      }
    }

    rawList.push({
      no,
      type,
      title,
      url,
      somaLectureId,
      author,
      dateTimeText,
      dateStr,
      registerDate,
      status,
      approval,
      hasCancelButton,
      mentorDeleted,
    });
  }

  return rawList;
}

export function collectPageIndexes(doc: Document): Set<number> {
  const indexes = new Set<number>();

  const pagingEl = doc.querySelector('.paging, .pagination, [class*="paging"]');
  if (!pagingEl) return indexes;

  pagingEl.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const onclick = link.getAttribute('onclick') || '';

    const fromHref = href.match(/pageIndex=(\d+)/);
    if (fromHref) indexes.add(parseInt(fromHref[1], 10));

    // fn_link_page(N) or similar JS pagination
    const fromOnclick = onclick.match(/\((\d+)\)/);
    if (fromOnclick) indexes.add(parseInt(fromOnclick[1], 10));
  });

  return indexes;
}

/**
 * 현재 페이지부터 시작해 페이지네이션을 따라가며 모든 신청내역 행을 모은다.
 * 페치한 페이지에서 새 페이지 링크를 발견하면 큐에 추가하고(비순차 pager 대응),
 * 마지막에 somaLectureId 로 중복 제거한다(같은 강의가 여러 페이지에 보일 수 있음).
 */
async function fetchAllRawRows(): Promise<RawLectureRow[]> {
  const rawList = extractRawRowsFromDoc(document, true);

  const currentUrl = new URL(window.location.href);
  const seenIndexes = new Set<number>([
    parseInt(currentUrl.searchParams.get('pageIndex') || '1', 10),
  ]);
  const pendingIndexes = new Set<number>(collectPageIndexes(document));

  for (const idx of pendingIndexes) {
    if (seenIndexes.has(idx)) continue;
    seenIndexes.add(idx);

    const pageUrl = new URL(currentUrl.href);
    pageUrl.searchParams.set('pageIndex', String(idx));

    try {
      const resp = await fetch(pageUrl.toString(), { credentials: 'include' });
      if (!resp.ok) continue;
      const html = await resp.text();
      const pageDoc = new DOMParser().parseFromString(html, 'text/html');

      rawList.push(...extractRawRowsFromDoc(pageDoc, false));

      // Discover additional page links from fetched page (handles non-sequential pagers)
      for (const newIdx of collectPageIndexes(pageDoc)) {
        if (!seenIndexes.has(newIdx)) pendingIndexes.add(newIdx);
      }
    } catch (e) {
      console.error(`Failed to fetch page ${idx}:`, e);
    }
  }

  // Deduplicate by SOMA lecture id — same lecture can appear across multiple pages
  const seenSomaLectureIds = new Set<string>();
  return rawList.filter((raw) => {
    if (!raw.somaLectureId) return true;
    if (seenSomaLectureIds.has(raw.somaLectureId)) return false;
    seenSomaLectureIds.add(raw.somaLectureId);
    return true;
  });
}

/**
 * 신청내역 전 페이지를 파싱하고 상세 페이지 정보를 병합해 Lecture 목록을 만든다.
 * 일시·멘토·승인은 상세 우선·리스트 폴백이고, 취소 가능 여부는 SOMA 의 취소 링크 존재로만 판정한다.
 */
export async function parseLecturesTable(): Promise<Lecture[]> {
  const allRaw = await fetchAllRawRows();

  // Filter out cancelled registrations ("취소불가" = still active, must keep).
  // Mentor-deleted lectures are kept (and marked in the UI) so the user's own
  // registrations don't silently disappear.
  const rawList = allRaw.filter((raw) => {
    const combined = `${raw.status} ${raw.approval}`;
    return !/취소/.test(combined) || /취소불가/.test(combined);
  });

  const lectures: Lecture[] = [];

  for (const raw of rawList) {
    let details: LectureDetails;
    if (raw.somaLectureId && raw.url) {
      details = await fetchLectureDetails(raw.somaLectureId, raw.url, raw.dateTimeText);
    } else {
      details = { ...NO_DETAILS };
    }

    // 상세 페이지의 강의날짜(시간 포함)를 우선 사용, 없으면 리스트 페이지 값 fallback
    const resolvedDateTimeText = details.lectureDateTimeText || raw.dateTimeText;
    const ended = isLectureEnded(resolvedDateTimeText);

    lectures.push({
      ...raw,
      dateTimeText: resolvedDateTimeText,
      mentorName: details.mentorName === '정보 없음' ? raw.author : details.mentorName,
      location: details.location,
      people: formatPeopleSummary(details.people),
      approvalStatus: formatApprovalStatus(
        details.approvalStatus === '정보 없음' ? raw.approval : details.approvalStatus
      ),
      deadlineStatus: formatDeadlineStatus(details.deadlineStatus, `${raw.status} ${raw.approval}`, ended),
      cancelAllowed: raw.hasCancelButton,
    });
  }

  return lectures;
}
