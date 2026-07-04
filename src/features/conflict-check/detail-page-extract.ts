// Scrapes the SOMA mentoring detail page for the lecture's date-time text and
// title. Pure DOM reads with no module state — split out of detail-page-conflict
// so that file can stay focused on banner/button-blocking logic.

import { parseLectureDateTimeText } from '@shared/date/date-time';

/**
 * 상세 페이지에서 강의 일시를 추출한다. 우선순위 폴백 3단계:
 * ① div.group/th 의 일시 라벨 옆 값 → ② 모든 잎 노드(td/span/div/p) 텍스트 regex
 * → ③ body 전체 텍스트 regex. 뒤로 갈수록 범위가 넓고 느슨해진다 — 충돌 검사가
 * 일시를 못 읽어 통째로 건너뛰는 '놓침'을 줄이려 정확도를 일부 희생한 것.
 * @returns 일시 문자열(라벨 매칭 시 "YYYY-MM-DD HH:MM ~ HH:MM" 정규형, 폴백은 원문일 수 있음), 못 찾으면 null
 */
export function findLectureDateTimeOnDetailPage(): string | null {
  const eventDateEl = document.querySelector('.eventDt');
  if (eventDateEl) {
    const group = eventDateEl.closest('.group');
    const valueEl = group?.querySelector('.c');
    const valueText = valueEl?.textContent?.trim().replace(/\s+/g, ' ') || '';
    const match = parseLectureDateTimeText(valueText);
    if (match) {
      const { y, m, d, sh, sm, eh, em } = match;
      return `${y}-${m}-${d} ${sh}:${sm} ~ ${eh}:${em}`;
    }
  }

  const groups = document.querySelectorAll('div.group');
  for (const group of groups) {
    const labelEl = group.querySelector('strong.t');
    const valueEl = group.querySelector('div.c');
    if (!labelEl || !valueEl) continue;

    const headerText = (labelEl.textContent || '').trim();
    const valueText = (valueEl.textContent || '').trim().replace(/\s+/g, ' ');

    if (headerText.includes('강의날짜') || headerText.includes('강의일시') || headerText.includes('교육일시')) {
      const match = parseLectureDateTimeText(valueText);
      if (match) {
        const { y, m, d, sh, sm, eh, em } = match;
        return `${y}-${m}-${d} ${sh}:${sm} ~ ${eh}:${em}`;
      }
    }
  }

  const ths = document.querySelectorAll('th');
  let dateStr = '';
  let timeStr = '';

  // Attempt 1: Search table rows with header labels
  for (const th of ths) {
    const headerText = (th.textContent || '').trim();
    const normalizedHeader = headerText.replace(/\s+/g, '');
    const td = th.nextElementSibling;
    if (!td) continue;
    const valueText = (td.textContent || '').trim().replace(/\s+/g, ' ');

    // 강의날짜 헤더를 최우선 처리 — 접수기간보다 먼저 반환
    if (normalizedHeader.includes('강의날짜') || headerText.includes('강의일시') || headerText.includes('교육일시')) {
      const match = parseLectureDateTimeText(valueText);
      if (match) {
        const { y, m, d, sh, sm, eh, em } = match;
        return `${y}-${m}-${d} ${sh}:${sm} ~ ${eh}:${em}`;
      }
    }

    if (headerText.includes('일시') || headerText.includes('강의일시') || headerText.includes('교육일시')) {
      const match = valueText.match(/(\d{4})[-./](\d{2})[-./](\d{2})(?:\([^)]+\))?\s*(\d{2}):(\d{2})/);
      if (match) return valueText;
    }

    if (
      headerText.includes('일자') ||
      headerText.includes('날짜') ||
      headerText.includes('교육일') ||
      headerText.includes('강의일')
    ) {
      const dateMatch = valueText.match(/(\d{4})[-./](\d{2})[-./](\d{2})/);
      if (dateMatch) {
        dateStr = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      }
    }

    if (headerText.includes('시간') || headerText.includes('교육시간') || headerText.includes('강의시간')) {
      const timeMatch = valueText.match(/(\d{2}):(\d{2})\s*~\s*(\d{2}):(\d{2})/);
      if (timeMatch) {
        timeStr = timeMatch[0];
      }
    }
  }

  if (dateStr && timeStr) {
    return `${dateStr} ${timeStr}`;
  }

  // Attempt 2: Fallback to searching all text nodes
  const leafElements = document.querySelectorAll('td, span, div, p');
  for (const el of leafElements) {
    if (el.children.length > 0) continue;
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const match = text.match(/(\d{4})[-./](\d{2})[-./](\d{2})(?:\([^)]+\))?\s*(\d{2}):(\d{2})/);
    if (match) {
      return text;
    }
  }

  // Attempt 3: General search in body text
  const bodyText = document.body.innerText.replace(/\s+/g, ' ');
  const dateMatchBody = bodyText.match(/(\d{4})[-./](\d{2})[-./](\d{2})/);
  const timeMatchBody = bodyText.match(/(\d{2}):(\d{2})\s*~\s*(\d{2}):(\d{2})/);
  if (dateMatchBody && timeMatchBody) {
    return `${dateMatchBody[1]}-${dateMatchBody[2]}-${dateMatchBody[3]} ${timeMatchBody[0]}`;
  }

  return null;
}

const TITLE_LABEL_RE = /(모집명|과정명|강의명|강좌명|교육명|프로그램명|강의제목|제목)/;

export function findLectureTitleOnDetailPage(): string | null {
  const tryLabeled = (labelEl: Element | null, valueEl: Element | null): string | null => {
    if (!labelEl || !valueEl) return null;
    if (!TITLE_LABEL_RE.test((labelEl.textContent || '').replace(/\s+/g, ''))) return null;
    const val = (valueEl.textContent || '').trim().replace(/\s+/g, ' ');
    return val || null;
  };

  for (const group of document.querySelectorAll('div.group')) {
    const val = tryLabeled(group.querySelector('strong.t'), group.querySelector('div.c'));
    if (val) return val;
  }
  for (const th of document.querySelectorAll('th')) {
    const val = tryLabeled(th, th.nextElementSibling);
    if (val) return val;
  }
  for (const dt of document.querySelectorAll('dt')) {
    const val = tryLabeled(dt, dt.nextElementSibling);
    if (val) return val;
  }

  const headingEl = document.querySelector(
    '.eventTit, .view_top .tit, .board_view .tit, .bbsView .tit, .view_tit, h3.tit, h2.tit'
  );
  const headingText = (headingEl?.textContent || '').trim().replace(/\s+/g, ' ');
  return headingText || null;
}

// 두 출처(상세 페이지 제목 vs 신청내역 테이블 제목)의 표기 차이를 흡수한다.
// 멘토특강/자유멘토링 같은 앞쪽 [태그]·(태그)·【태그】는 제거 후 공백을 정규화한다.
export function normalizeLectureTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.replace(/\s+/g, ' ').trim();
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/^[[(【（［][^\])】）］]*[\])】）］]\s*/, '').trim();
  }
  return s;
}
