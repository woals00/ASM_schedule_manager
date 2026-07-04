// Scrapes the SOMA mentoring detail page (mentoLec/view.do) for the label/value
// fields shared by the registration-history detail fetch and the mentoLec board
// location cache. Tries the page's three known layouts (div.group, th/td, dt/dd)
// plus a location keyword fallback; first non-empty value per field wins.

export interface SomaDetailFields {
  mentorName: string;
  location: string;
  people: string;
  approvalStatus: string;
  deadlineStatus: string;
  lectureDateTimeText: string;
}

export function extractSomaDetailFields(doc: Document): SomaDetailFields {
  let mentorName = '';
  let location = '';
  let people = '';
  let approvalStatus = '';
  let deadlineStatus = '';
  let lectureDateTimeText = '';

  const captureDetailField = (label: string, value: string) => {
    const normalizedLabel = label.replace(/\s+/g, '');
    const normalizedValue = value.replace(/\s+/g, ' ').trim();

    if (!mentorName && /작성자|멘토명|멘토/.test(normalizedLabel) && !/멘토링/.test(normalizedLabel)) {
      mentorName = normalizedValue;
      return;
    }

    if (!location && /장소|위치/.test(normalizedLabel)) {
      location = normalizedValue;
      return;
    }

    if (
      !people &&
      /(?:모집|신청)?인원|정원/.test(normalizedLabel) &&
      !/모집명|과정명|강의명|제목/.test(normalizedLabel)
    ) {
      people = normalizedValue;
      return;
    }

    if (!approvalStatus && /개설승인여부|개설승인|승인여부|개설여부/.test(normalizedLabel)) {
      approvalStatus = normalizedValue;
      return;
    }

    if (
      !deadlineStatus &&
      /마감여부|접수상태|신청상태|모집상태|진행상태|상태/.test(normalizedLabel) &&
      !/승인/.test(normalizedLabel)
    ) {
      deadlineStatus = normalizedValue;
      return;
    }

    if (!lectureDateTimeText && /강의날짜|강의일시|진행날짜|진행일시|교육일시/.test(normalizedLabel)) {
      lectureDateTimeText = normalizedValue;
    }
  };

  const isComplete = () =>
    Boolean(mentorName && location && people && approvalStatus && deadlineStatus);

  // Attempt 1: div.group > strong.t + div.c (SOMA mentoring detail page structure)
  doc.querySelectorAll('div.group').forEach((group) => {
    const labelEl = group.querySelector('strong.t');
    const valueEl = group.querySelector('div.c');
    if (!labelEl || !valueEl) return;
    const label = (labelEl.textContent || '').trim();
    const val = (valueEl.textContent || '').trim().replace(/\s+/g, ' ');
    captureDetailField(label, val);
  });

  // Attempt 2: th/td table structure
  if (!isComplete()) {
    doc.querySelectorAll('th').forEach((th) => {
      const label = (th.textContent || '').trim();
      const td = th.nextElementSibling;
      if (!td) return;
      const val = (td.textContent || '').trim().replace(/\s+/g, ' ');
      captureDetailField(label, val);
    });
  }

  // Attempt 3: dt/dd structure
  if (!isComplete()) {
    doc.querySelectorAll('dt').forEach((dt) => {
      const label = (dt.textContent || '').trim();
      const dd = dt.nextElementSibling;
      if (!dd) return;
      const val = (dd.textContent || '').trim().replace(/\s+/g, ' ');
      captureDetailField(label, val);
    });
  }

  // Attempt 4: location keyword scan in td
  if (!location) {
    const tds = doc.querySelectorAll('td');
    for (const td of tds) {
      const text = td.textContent || '';
      if (
        text.includes('온라인(webex)') ||
        text.includes('회의실') ||
        text.includes('하이스퀘어') ||
        text.includes('하이텐')
      ) {
        location = text.trim().replace(/\s+/g, ' ');
        break;
      }
    }
  }

  return { mentorName, location, people, approvalStatus, deadlineStatus, lectureDateTimeText };
}
