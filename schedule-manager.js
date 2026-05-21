// SOMA Schedule Manager - Schedule Manager Script
// Automatically parses registration tables, renders a calendar, and manages personal schedules with conflict checks.

(async function () {
  'use strict';

  // 10 minutes cache TTL for future SOMA lectures
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const CALENDAR_DAY_COUNT = 30;
  const CALENDAR_SHIFT_WEEKS = 2;
  const ALARM_SETTINGS_KEY = 'soma_alarm_sync_settings';
  const ALARM_SYNC_META_KEY = 'soma_alarm_sync_meta';
  const CENTRAL_WORKER_BASE_URL = 'https://asm-schedule-alarm.pa6764.workers.dev';
  const FIXED_SHARED_SCHEDULES = [
    {
      id: 'shared_orientation_2026_06_30',
      title: '발대식',
      dateStr: '2026-06-30',
      startTime: '00:00',
      endTime: '23:59',
      description: '모든 연수생 공통 일정',
      isFixedShared: true
    }
  ];

  // Extension State
  let startOffsetWeeks = 0; // 0 means starting from the Sunday of current week
  let hideEndedLectures = false;
  let editingScheduleId = null;
  let lastAutoSyncSignature = '';

  // Helper: check if a lecture/schedule has ended
  function isLectureEnded(dateTimeText) {
    const match = dateTimeText.match(/(\d{4})-(\d{2})-(\d{2})\([^)]+\)\s*(\d{2}):(\d{2})(?::\d{2})?\s*~\s*(\d{2}):(\d{2})(?::\d{2})?/);
    if (!match) return false;
    const [_, y, m, d, sh, sm, eh, em] = match;
    const endTime = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(eh, 10), parseInt(em, 10), 0);
    return endTime < new Date();
  }


  function formatPeopleSummary(peopleText) {
    const normalized = (peopleText || '').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized === '정보 없음' || normalized === '로딩 중...') return '정보 없음';

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

  function extractApplicantCount(doc) {
    const summaryText = doc.querySelector('.total-normal')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const summaryMatch = summaryText.match(/\[\s*(\d+)\s*명\s*\]/);
    if (summaryMatch) return summaryMatch[1];

    const scriptText = Array.from(doc.scripts).map(script => script.textContent || '').join('\n');
    const appCountMatch = scriptText.match(/appCnt\s*:\s*"(\d+)"/);
    if (appCountMatch) return appCountMatch[1];

    const activeApplicants = Array.from(doc.querySelectorAll('.boardlist table tbody tr'))
      .filter(row => !row.querySelector('.color-red') && row.textContent.includes('[신청완료]'))
      .length;

    return activeApplicants > 0 ? String(activeApplicants) : '';
  }

  function formatDeadlineStatus(rawStatus, approval, isEnded) {
    if (isEnded) return '마감';

    const normalizedStatus = (rawStatus || '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
    if (normalizedStatus && normalizedStatus !== '정보 없음' && normalizedStatus !== '로딩 중...') {
      if (/접수중|모집중/.test(normalizedStatus)) return '접수중';
      if (/마감|종료|불가|완료/.test(normalizedStatus)) return '마감';
      return normalizedStatus;
    }

    const combined = [rawStatus, approval]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!combined || combined === '정보 없음' || combined === '로딩 중...') {
      return '정보 없음';
    }

    if (/마감|종료|불가|완료/.test(combined)) return '마감';
    if (/진행|가능|접수중|모집중|승인/.test(combined)) return '진행중';
    return combined;
  }

  function formatApprovalStatus(rawApproval) {
    const normalized = (rawApproval || '').replace(/\s+/g, ' ').trim();
    if (!normalized || normalized === '정보 없음' || normalized === '로딩 중...') {
      return '정보 없음';
    }

    if (/승인|개설/.test(normalized) && !/미승인|승인대기|대기/.test(normalized)) {
      return '승인';
    }

    if (/대기/.test(normalized)) return '대기';
    if (/미승인|반려|취소/.test(normalized)) return '미승인';
    return normalized;
  }

  function parseLectureDateTimeText(dateTimeText) {
    if (!dateTimeText) return null;

    const normalized = dateTimeText.replace(/\s+/g, ' ').trim();
    const dateMatch = normalized.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
    if (!dateMatch) return null;

    const timeSource = normalized.slice((dateMatch.index || 0) + dateMatch[0].length);
    const timeMatch = timeSource.match(
      /(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?\s*시?\s*[~\-]\s*(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?\s*시?/
    );
    if (!timeMatch) return null;

    const [, y, m, d] = dateMatch;
    const [, startMeridiem, startHourRaw, startMinuteRaw = '00', endMeridiem, endHourRaw, endMinuteRaw = '00'] = timeMatch;

    const normalizeHour = (hourRaw, meridiem) => {
      let hour = parseInt(hourRaw, 10);
      if (Number.isNaN(hour)) return null;
      if (meridiem === '오전' && hour === 12) hour = 0;
      if (meridiem === '오후' && hour < 12) hour += 12;
      return String(hour).padStart(2, '0');
    };

    const sh = normalizeHour(startHourRaw, startMeridiem);
    const eh = normalizeHour(endHourRaw, endMeridiem);
    if (!sh || !eh) return null;

    return {
      y,
      m: String(parseInt(m, 10)).padStart(2, '0'),
      d: String(parseInt(d, 10)).padStart(2, '0'),
      sh,
      sm: String(parseInt(startMinuteRaw, 10)).padStart(2, '0'),
      eh,
      em: String(parseInt(endMinuteRaw, 10)).padStart(2, '0')
    };
  }

  async function loadPersonalSchedules() {
    return new Promise(resolve => {
      chrome.storage.local.get(['soma_personal_schedules'], (res) => {
        resolve(res.soma_personal_schedules || []);
      });
    });
  }

  function buildKstIsoString(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    if ([y, m, d, hh, mm].some(Number.isNaN)) return null;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`;
  }

  function pickLectureTimes(dateTimeText, dateStr) {
    const parsed = parseLectureDateTimeText(dateTimeText);
    if (!parsed) return { startAt: '', endAt: '' };

    const normalizedDateStr = dateStr || `${parsed.y}-${parsed.m}-${parsed.d}`;
    const startAt = buildKstIsoString(normalizedDateStr, `${parsed.sh}:${parsed.sm}`);
    const endAt = buildKstIsoString(normalizedDateStr, `${parsed.eh}:${parsed.em}`);

    return {
      startAt: startAt || '',
      endAt: endAt || ''
    };
  }

  function deriveAlarmUserId(settings = {}) {
    return (settings.userId || '').trim().toLowerCase();
  }

  function sanitizeAlarmSettings(input = {}) {
    return {
      workerBaseUrl: CENTRAL_WORKER_BASE_URL,
      userId: (input.userId || '').trim().toLowerCase(),
      userLabel: (input.userLabel || '').trim(),
      discordWebhookUrl: (input.discordWebhookUrl || '').trim(),
      notificationsEnabled: input.notificationsEnabled !== false,
      autoSyncEnabled: input.autoSyncEnabled !== false
    };
  }

  async function loadAlarmSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get([ALARM_SETTINGS_KEY], (result) => {
        resolve(sanitizeAlarmSettings(result[ALARM_SETTINGS_KEY] || {}));
      });
    });
  }

  async function saveAlarmSettings(settings) {
    const sanitized = sanitizeAlarmSettings(settings);
    await new Promise(resolve => {
      chrome.storage.local.set({ [ALARM_SETTINGS_KEY]: sanitized }, resolve);
    });
    return sanitized;
  }

  async function saveAlarmSyncMeta(meta) {
    await new Promise(resolve => {
      chrome.storage.local.set({
        [ALARM_SYNC_META_KEY]: {
          ...meta,
          updatedAt: Date.now()
        }
      }, resolve);
    });
  }

  async function loadAlarmSyncMeta() {
    return new Promise(resolve => {
      chrome.storage.local.get([ALARM_SYNC_META_KEY], (result) => {
        resolve(result[ALARM_SYNC_META_KEY] || null);
      });
    });
  }

  async function extensionFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'asm-worker-fetch',
        url,
        options
      }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || '확장 프로그램 백그라운드 요청에 실패했습니다.'));
          return;
        }

        if (!response) {
          reject(new Error('백그라운드 응답이 비어 있습니다.'));
          return;
        }

        resolve(response);
      });
    });
  }

  function lectureToAlarmSchedule(lecture) {
    if (!lecture?.dateStr || !lecture?.dateTimeText) return null;
    const { startAt, endAt } = pickLectureTimes(lecture.dateTimeText, lecture.dateStr);
    if (!startAt || !endAt) return null;

    return {
      sourceEventId: lecture.qustnrSn || `${lecture.dateStr}_${lecture.title}_${lecture.type}`,
      title: lecture.title,
      lectureType: lecture.type,
      mentorName: lecture.mentorName || lecture.author || '',
      startsAt: startAt,
      endsAt: endAt,
      location: lecture.location || '',
      status: lecture.deadlineStatus || lecture.status || '',
      detailUrl: lecture.url ? new URL(lecture.url, window.location.origin).toString() : '',
      cancelable: Boolean(lecture.hasCancelButton)
    };
  }

  function buildAlarmPayload(lectures, settings) {
    const now = Date.now();
    const parseFailures = [];
    const lectureFailures = [];
    const lectureCandidates = lectures
      .filter(lecture => !isLectureEnded(lecture.dateTimeText))
      .map(lecture => {
        const schedule = lectureToAlarmSchedule(lecture);
        if (!schedule) {
          parseFailures.push({
            title: lecture.title,
            raw: lecture.dateTimeText
          });
          lectureFailures.push({
            title: lecture.title,
            raw: lecture.dateTimeText
          });
        }
        return { lecture, schedule };
      })
      .filter(item => item?.schedule);

    const lectureDroppedAsPast = [];
    const schedules = lectureCandidates
      .map(item => {
        const startsAt = new Date(item.schedule.startsAt).getTime();
        if (Number.isNaN(startsAt) || startsAt < now) {
          lectureDroppedAsPast.push({
            title: item.lecture.title,
            raw: item.lecture.dateTimeText,
            startsAt: item.schedule.startsAt
          });
          return null;
        }
        return item.schedule;
      })
      .filter(Boolean);

    return {
      userId: deriveAlarmUserId(settings) || 'default-user',
      userLabel: settings.userLabel || '',
      notifyEnabled: settings.notificationsEnabled,
      notificationTargets: {
        discordWebhookUrl: settings.discordWebhookUrl
      },
      schedules,
      parseFailures,
      debug: {
        nowIso: new Date(now).toISOString(),
        lectureInputCount: lectures.length,
        lectureScheduleCount: schedules.length,
        lectureFailures,
        lectureDroppedAsPast: lectureDroppedAsPast.slice(0, 5)
      }
    };
  }

  function getAlarmPayloadSignature(payload) {
    return JSON.stringify({
      userId: payload.userId,
      userLabel: payload.userLabel,
      notifyEnabled: payload.notifyEnabled,
      notificationTargets: payload.notificationTargets,
      schedules: payload.schedules.map(schedule => ({
        sourceEventId: schedule.sourceEventId,
        title: schedule.title,
        lectureType: schedule.lectureType,
        mentorName: schedule.mentorName,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        location: schedule.location,
        status: schedule.status,
        detailUrl: schedule.detailUrl,
        cancelable: schedule.cancelable
      }))
    });
  }

  async function syncSchedulesToCloudflare(lectures, settings, options = {}) {
    const syncSettings = sanitizeAlarmSettings(settings);
    if (!deriveAlarmUserId(syncSettings)) {
      throw new Error('소마 계정 이메일을 먼저 입력해야 합니다.');
    }
    if (!syncSettings.discordWebhookUrl) {
      throw new Error('Discord Webhook URL을 먼저 입력해야 합니다.');
    }

    const payload = buildAlarmPayload(lectures, syncSettings);
    console.log('ASM alarm payload debug:', payload.debug);

    if (payload.schedules.length === 0 && !options.allowEmptySchedules) {
      if (payload.parseFailures.length > 0) {
        const firstFailure = payload.parseFailures[0];
        throw new Error(`일정 ${payload.parseFailures.length}건의 시간 파싱에 실패했습니다. 예: ${firstFailure.title} / ${firstFailure.raw}`);
      }
      throw new Error('동기화할 예정된 신청 일정이 없습니다.');
    }

    const signature = getAlarmPayloadSignature(payload);
    const lastSyncMeta = await loadAlarmSyncMeta();
    const lastSignature = lastSyncMeta?.signature || '';
    if (options.auto && (signature === lastSignature || signature === lastAutoSyncSignature)) {
      await saveAlarmSyncMeta({
        success: true,
        skipped: true,
        signature,
        scheduleCount: payload.schedules.length,
        workerBaseUrl: syncSettings.workerBaseUrl,
        message: '변경된 일정이 없어 동기화를 건너뛰었습니다.'
      });
      return { skipped: true, message: '변경된 일정이 없어 동기화를 건너뛰었습니다.' };
    }

    const response = await extensionFetch(`${syncSettings.workerBaseUrl}/api/public/schedules/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseText = response.text || '';
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.error || data?.message || response.error || `동기화 요청이 실패했습니다. (${response.status || 'network'})`;
      throw new Error(message);
    }

    lastAutoSyncSignature = signature;
    await saveAlarmSyncMeta({
      success: true,
      skipped: false,
      signature,
      scheduleCount: payload.schedules.length,
      workerBaseUrl: syncSettings.workerBaseUrl
    });

    return {
      skipped: false,
      scheduleCount: payload.schedules.length,
      message: data?.message || `일정 ${payload.schedules.length}건을 동기화했습니다.`
    };
  }

  // Fetch SOMA lecture details (Location & Enrollment) with cache support
  async function fetchLectureDetails(qustnrSn, url, dateTimeText) {
    if (!url) {
      return {
        mentorName: '정보 없음',
        location: '정보 없음',
        people: '정보 없음',
        approvalStatus: '정보 없음',
        deadlineStatus: '정보 없음'
      };
    }

    const cacheKey = `soma_lecture_detail_${qustnrSn}`;
    const cached = await new Promise(resolve => {
      chrome.storage.local.get([cacheKey], (result) => {
        resolve(result[cacheKey]);
      });
    });

    const isPast = isLectureEnded(dateTimeText);
    const now = Date.now();

    const hasDetailCacheShape = cached && Object.prototype.hasOwnProperty.call(cached, 'approvalStatus');

    if (cached && hasDetailCacheShape) {
      if (isPast || (cached.timestamp && now - cached.timestamp < CACHE_TTL_MS)) {
        return {
          mentorName: cached.mentorName || '정보 없음',
          location: cached.location,
          people: cached.people,
          approvalStatus: cached.approvalStatus || '정보 없음',
          deadlineStatus: cached.deadlineStatus || '정보 없음'
        };
      }
    }

    try {
      const absoluteUrl = url.startsWith('http') ? url : `${window.location.origin}${url.startsWith('/') ? url : '/' + url}`;
      const response = await fetch(absoluteUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Network error');
      const htmlText = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      let mentorName = '';
      let location = '';
      let people = '';
      let approvalStatus = '';
      let deadlineStatus = '';

      const captureDetailField = (label, value) => {
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
        }
      };

      // Attempt 1: div.group > strong.t + div.c (SOMA mentoring detail page structure)
      const groups = doc.querySelectorAll('div.group');
      groups.forEach(group => {
        const labelEl = group.querySelector('strong.t');
        const valueEl = group.querySelector('div.c');
        if (!labelEl || !valueEl) return;
        const label = labelEl.textContent.trim();
        const val = valueEl.textContent.trim().replace(/\s+/g, ' ');
        captureDetailField(label, val);
      });

      // Attempt 2: th/td table structure
      if (!mentorName || !location || !people || !approvalStatus || !deadlineStatus) {
        const ths = doc.querySelectorAll('th');
        ths.forEach(th => {
          const label = th.textContent.trim();
          const td = th.nextElementSibling;
          if (!td) return;
          const val = td.textContent.trim().replace(/\s+/g, ' ');
          captureDetailField(label, val);
        });
      }

      // Attempt 3: dt/dd structure
      if (!mentorName || !location || !people || !approvalStatus || !deadlineStatus) {
        const dts = doc.querySelectorAll('dt');
        dts.forEach(dt => {
          const label = dt.textContent.trim();
          const dd = dt.nextElementSibling;
          if (!dd) return;
          const val = dd.textContent.trim().replace(/\s+/g, ' ');
          captureDetailField(label, val);
        });
      }

      // Attempt 4: keyword scan in td
      if (!location) {
        const tds = doc.querySelectorAll('td');
        for (const td of tds) {
          const text = td.textContent;
          if (text.includes('온라인(webex)') || text.includes('회의실') || text.includes('하이스퀘어') || text.includes('하이텐')) {
            location = text.trim().replace(/\s+/g, ' ');
            break;
          }
        }
      }

      const applicantCount = extractApplicantCount(doc);
      if (people && applicantCount) {
        const capacityMatch = people.match(/(\d+)/);
        if (capacityMatch) {
          people = `${applicantCount} / ${capacityMatch[1]}`;
        }
      }

      const finalMentorName = mentorName || '정보 없음';
      const finalLocation = location || '정보 없음';
      const finalPeople = people || '정보 없음';
      const finalApprovalStatus = approvalStatus || '정보 없음';
      const finalDeadlineStatus = deadlineStatus || '정보 없음';

      // Save to cache
      const detailsToCache = {
        mentorName: finalMentorName,
        location: finalLocation,
        people: finalPeople,
        approvalStatus: finalApprovalStatus,
        deadlineStatus: finalDeadlineStatus,
        dateTimeText: dateTimeText,
        timestamp: Date.now()
      };

      const cacheObj = {};
      cacheObj[cacheKey] = detailsToCache;
      await new Promise(resolve => {
        chrome.storage.local.set(cacheObj, resolve);
      });

      return {
        mentorName: finalMentorName,
        location: finalLocation,
        people: finalPeople,
        approvalStatus: finalApprovalStatus,
        deadlineStatus: finalDeadlineStatus
      };
    } catch (e) {
      console.error(`Failed to fetch details for lecture ${qustnrSn}:`, e);
      return {
        mentorName: '정보 없음',
        location: '정보 없음',
        people: '정보 없음',
        approvalStatus: '정보 없음',
        deadlineStatus: '정보 없음'
      };
    }
  }

  // Parse original SOMA table rows
  async function parseLecturesTable() {
    const rows = document.querySelectorAll('.boardlist table tbody tr');
    const lectures = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) continue; // Skip header/footer/empty rows

      const no = cells[0].textContent.trim();
      const type = cells[1].textContent.trim();
      
      const titleLink = cells[2].querySelector('a');
      const title = titleLink ? titleLink.textContent.trim() : cells[2].textContent.trim();
      const url = titleLink ? titleLink.getAttribute('href') : '';
      
      let qustnrSn = '';
      if (url) {
        const match = url.match(/[?&]qustnrSn=(\d+)/);
        if (match) {
          qustnrSn = match[1];
        }
      }

      const author = cells[3].textContent.trim();
      const dateTimeText = cells[4].innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      
      const dateMatch = dateTimeText.match(/(\d{4})-(\d{2})-(\d{2})/);
      const dateStr = dateMatch ? dateMatch[0] : '';
      
      const registerDate = cells[5].textContent.trim().replace(/\s+/g, ' ');
      const status = cells[6].textContent.trim();
      const approval = cells[7].textContent.trim();
      
      const hasCancelButton = !!row.querySelector('[onclick*="delDate"]');

      let details = {
        mentorName: '로딩 중...',
        location: '로딩 중...',
        people: '로딩 중...',
        approvalStatus: '로딩 중...',
        deadlineStatus: '로딩 중...'
      };
      if (qustnrSn && url) {
        details = await fetchLectureDetails(qustnrSn, url, dateTimeText);
      }

      const ended = isLectureEnded(dateTimeText);

      lectures.push({
        no,
        type,
        title,
        url,
        qustnrSn,
        author,
        dateTimeText,
        dateStr,
        registerDate,
        status,
        approval,
        hasCancelButton,
        mentorName: details.mentorName === '정보 없음' ? author : details.mentorName,
        location: details.location,
        people: formatPeopleSummary(details.people),
        approvalStatus: formatApprovalStatus(details.approvalStatus === '정보 없음' ? approval : details.approvalStatus),
        deadlineStatus: formatDeadlineStatus(details.deadlineStatus, `${status} ${approval}`, ended)
      });
    }

    return lectures;
  }

  // Trigger Cancel Registration
  function triggerCancellation(qustnrSn) {
    const rows = document.querySelectorAll('.boardlist table tbody tr');
    for (const row of rows) {
      const a = row.querySelector('.tit.popuser a');
      if (a && a.getAttribute('href').includes(`qustnrSn=${qustnrSn}`)) {
        const delBtn = row.querySelector('[onclick*="delDate"]');
        if (delBtn) {
          delBtn.click();
          return;
        }
      }
    }
    alert('접수 취소 처리기(delDate)를 찾을 수 없습니다. 원래 표에서 취소 버튼을 눌러주십시오.');
  }

  // Inject personal schedule creation Modal DOM
  function injectModalDOM() {
    if (document.getElementById('personal-schedule-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'personal-schedule-modal';
    modal.className = 'modal-backdrop';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h4>➕ 새 개인 일정 등록</h4>
          <button type="button" class="close-modal-btn">&times;</button>
        </div>
        <form id="personal-schedule-form">
          <div class="form-group">
            <label for="schedule-title">일정 제목 *</label>
            <input type="text" id="schedule-title" required placeholder="예: 코딩테스트 스터디, 팀 미팅 등">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="schedule-date">날짜 *</label>
              <div class="date-input-row">
                <input type="date" id="schedule-date" required>
                <div class="date-presets">
                  <button type="button" class="preset-btn" data-preset="today">오늘</button>
                  <button type="button" class="preset-btn" data-preset="tomorrow">내일</button>
                </div>
              </div>
            </div>
          </div>
          <div class="form-row flex-row">
            <div class="form-group half">
              <label for="schedule-start-time">시작 시간 *</label>
              <select id="schedule-start-time" required></select>
            </div>
            <div class="form-group half">
              <label for="schedule-end-time">종료 시간 *</label>
              <select id="schedule-end-time" required></select>
            </div>
          </div>
          <div class="form-group">
            <label for="schedule-desc">설명 (선택)</label>
            <textarea id="schedule-desc" rows="3" placeholder="일정 세부 정보 또는 메모를 입력하세요."></textarea>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-cancel">취소</button>
            <button type="submit" class="btn-save">저장</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Populate Time Dropdowns (30-minute intervals)
    const startSelect = modal.querySelector('#schedule-start-time');
    const endSelect = modal.querySelector('#schedule-end-time');
    for (let h = 0; h < 24; h++) {
      for (const m of ['00', '30']) {
        const hh = String(h).padStart(2, '0');
        const timeVal = `${hh}:${m}`;

        const optStart = document.createElement('option');
        optStart.value = timeVal;
        optStart.textContent = timeVal;
        startSelect.appendChild(optStart);

        const optEnd = document.createElement('option');
        optEnd.value = timeVal;
        optEnd.textContent = timeVal;
        endSelect.appendChild(optEnd);
      }
    }
    startSelect.value = '09:00';
    endSelect.value = '10:00';

    // Auto set end time to start time + 1 hour
    startSelect.addEventListener('change', () => {
      const [h, m] = startSelect.value.split(':').map(Number);
      let endH = h + 1;
      let endM = m;
      if (endH >= 24) {
        endH = 23;
        endM = 30;
      }
      const endVal = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      endSelect.value = endVal;
    });

    // Date presets
    const dateInput = modal.querySelector('#schedule-date');
    const getFormattedDate = (offset = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    modal.querySelector('[data-preset="today"]').addEventListener('click', () => {
      dateInput.value = getFormattedDate(0);
    });
    modal.querySelector('[data-preset="tomorrow"]').addEventListener('click', () => {
      dateInput.value = getFormattedDate(1);
    });

    // Close listeners
    const closeBtn = modal.querySelector('.close-modal-btn');
    const cancelBtn = modal.querySelector('.btn-cancel');
    const closeModal = () => { modal.style.display = 'none'; };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Form submission
    const form = document.getElementById('personal-schedule-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const title = document.getElementById('schedule-title').value.trim();
      const dateStr = document.getElementById('schedule-date').value;
      const startTime = document.getElementById('schedule-start-time').value;
      const endTime = document.getElementById('schedule-end-time').value;
      const description = document.getElementById('schedule-desc').value.trim();

      if (startTime >= endTime) {
        alert('종료 시간은 시작 시간보다 늦어야 합니다.');
        return;
      }

      const currentList = await loadPersonalSchedules();

      if (editingScheduleId) {
        const index = currentList.findIndex(item => item.id === editingScheduleId);
        if (index !== -1) {
          currentList[index] = {
            ...currentList[index],
            title,
            dateStr,
            startTime,
            endTime,
            description
          };
        }
      } else {
        const newSchedule = {
          id: 'personal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          title,
          dateStr,
          startTime,
          endTime,
          description
        };
        currentList.push(newSchedule);
      }

      await new Promise(resolve => {
        chrome.storage.local.set({ soma_personal_schedules: currentList }, resolve);
      });

      closeModal();
      form.reset();
      editingScheduleId = null;
      startSelect.value = '09:00';
      endSelect.value = '10:00';

      const lectures = await parseLecturesTable();
      await syncSchedulesAfterLocalChange(lectures, currentList);
      renderCalendar(lectures);
    });
  }

  // Open modal with specific date helper
  function openModalWithDate(dateStr) {
    injectModalDOM();
    const modal = document.getElementById('personal-schedule-modal');
    if (!modal) return;

    editingScheduleId = null;
    modal.querySelector('.modal-header h4').textContent = '➕ 새 개인 일정 등록';

    const dateInput = modal.querySelector('#schedule-date');
    if (dateInput) {
      if (dateStr) {
        dateInput.value = dateStr;
      } else {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
      }
    }

    // Reset fields
    const titleInput = modal.querySelector('#schedule-title');
    if (titleInput) titleInput.value = '';
    const descTextarea = modal.querySelector('#schedule-desc');
    if (descTextarea) descTextarea.value = '';

    modal.style.display = 'flex';
    if (titleInput) {
      titleInput.focus();
    }
  }

  // Open modal for editing schedule helper
  function openModalForEditing(ps) {
    injectModalDOM();
    const modal = document.getElementById('personal-schedule-modal');
    if (!modal) return;

    editingScheduleId = ps.id;
    modal.querySelector('.modal-header h4').textContent = '✏️ 개인 일정 수정';

    // Populate existing values
    modal.querySelector('#schedule-title').value = ps.title;
    modal.querySelector('#schedule-date').value = ps.dateStr;
    modal.querySelector('#schedule-start-time').value = ps.startTime;
    modal.querySelector('#schedule-end-time').value = ps.endTime;
    modal.querySelector('#schedule-desc').value = ps.description || '';

    modal.style.display = 'flex';
    const titleInput = modal.querySelector('#schedule-title');
    if (titleInput) {
      titleInput.focus();
    }
  }

  async function openAlarmSettingsModal({ lectures, onSaved }) {
    let modal = document.getElementById('alarm-settings-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'alarm-settings-modal';
      modal.className = 'modal-backdrop';
      modal.style.display = 'none';
      document.body.appendChild(modal);
    }

    const currentSettings = await loadAlarmSettings();
    modal.innerHTML = `
      <div class="modal-content alarm-settings-modal-content">
        <div class="modal-header">
          <h4>🔔 알림 설정</h4>
          <button type="button" class="close-modal-btn">&times;</button>
        </div>
        <form id="alarm-settings-form">
          <div class="alarm-settings-grid">
            <label class="alarm-settings-field">
              <span>소마 계정 이메일</span>
              <input type="email" name="userId" placeholder="예: user@soma.or.kr" value="${currentSettings.userId}">
            </label>
            <label class="alarm-settings-field">
              <span>표시 이름</span>
              <input type="text" name="userLabel" placeholder="예: 재민" value="${currentSettings.userLabel}">
            </label>
            <label class="alarm-settings-field alarm-settings-field--full">
              <span>Discord Webhook URL</span>
              <input type="url" name="discordWebhookUrl" placeholder="https://discord.com/api/webhooks/..." value="${currentSettings.discordWebhookUrl}">
            </label>
          </div>
          <div class="alarm-settings-actions">
            <button type="submit" class="control-btn accent">설정 저장</button>
            <button type="button" class="control-btn secondary btn-cancel-alarm-setup">취소</button>
          </div>
        </form>
      </div>
    `;

    const closeModal = () => {
      modal.style.display = 'none';
    };

    modal.style.display = 'flex';
    const form = modal.querySelector('#alarm-settings-form');
    const closeBtn = modal.querySelector('.close-modal-btn');
    const cancelBtn = modal.querySelector('.btn-cancel-alarm-setup');

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    }, { once: true });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const nextSettings = await saveAlarmSettings({
        ...currentSettings,
        userId: form.userId.value,
        userLabel: form.userLabel.value,
        discordWebhookUrl: form.discordWebhookUrl.value,
        notificationsEnabled: true,
        autoSyncEnabled: currentSettings.autoSyncEnabled
      });

      try {
        await syncSchedulesToCloudflare(lectures, nextSettings, { auto: false });
        closeModal();
        if (typeof onSaved === 'function') {
          await onSaved();
        }
      } catch (error) {
        alert(error.message || '알림 설정 저장에 실패했습니다.');
      }
    });
  }

  async function toggleAlarmNotifications({ lectures, onChanged }) {
    const currentSettings = await loadAlarmSettings();
    const isConfigured = Boolean(currentSettings.userId && currentSettings.discordWebhookUrl);

    if (!isConfigured) {
      await openAlarmSettingsModal({ lectures, onSaved: onChanged });
      return { configured: false };
    }

    const nextSettings = await saveAlarmSettings({
      ...currentSettings,
      notificationsEnabled: !currentSettings.notificationsEnabled
    });

    try {
      await syncSchedulesToCloudflare(lectures, nextSettings, {
        auto: false,
        allowEmptySchedules: true
      });
    } catch (error) {
      console.error('Failed to toggle alarm notifications:', error);
    }

    if (typeof onChanged === 'function') {
      await onChanged();
    }

    return {
      configured: true,
      notificationsEnabled: nextSettings.notificationsEnabled
    };
  }

  async function syncSchedulesAfterLocalChange() {
    return { skipped: true, message: '개인 일정 변경은 알림 동기화 대상이 아닙니다.' };
  }

  async function syncSchedulesOnHistoryPageLoadIfConfigured(lectures) {
    const settings = await loadAlarmSettings();
    if (!settings.autoSyncEnabled) return null;
    if (!settings.discordWebhookUrl || !deriveAlarmUserId(settings)) return null;

    try {
      return await syncSchedulesToCloudflare(lectures, settings, { auto: true });
    } catch (error) {
      console.error('Auto sync on history page load failed:', error);
      await saveAlarmSyncMeta({
        success: false,
        skipped: false,
        message: error.message || '페이지 로드 자동 동기화 실패'
      });
      return null;
    }
  }

  // Render the Calendar UI
  async function renderCalendar(lectures) {
    const existing = document.getElementById('history-calendar');
    if (existing) {
      existing.remove();
    }

    const targetContainer = document.querySelector('.tabs-st1');
    if (!targetContainer) return;

    // Load personal schedules
    const personalSchedules = await loadPersonalSchedules();
    const alarmSettings = await loadAlarmSettings();
    const isAlarmConfigured = Boolean(alarmSettings.userId && alarmSettings.discordWebhookUrl);
    const alarmToggleLabel = !isAlarmConfigured
      ? '🔔 알림 받기'
      : (alarmSettings.notificationsEnabled ? '🔔 알림 끄기' : '🔕 알림 받기');

    const mergedPersonalSchedules = [...FIXED_SHARED_SCHEDULES, ...personalSchedules];

    const calendarWrapper = document.createElement('div');
    calendarWrapper.id = 'history-calendar';

    // 1. Calendar Header / Dashboard Toolbar
    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = `
      <div class="calendar-title-group">
        <h3>📅 멘토링 / 특강 & 개인 일정 대시보드</h3>
        <span class="calendar-subtitle">접수한 일정과 내 개인 일정을 함께 모아 관리합니다.</span>
      </div>
      <div class="calendar-controls">
        <button id="btn-toggle-alarm" class="control-btn secondary">${alarmToggleLabel}</button>
        <button id="btn-prev-weeks" class="control-btn">⬆ 이전 2주 보기</button>
        <button id="btn-reset-weeks" class="control-btn secondary" ${startOffsetWeeks === 0 ? 'hidden' : ''}>↩ 이번주부터 보기</button>
        <button id="btn-toggle-ended" class="control-btn secondary">${hideEndedLectures ? '👁️ 종료된 일정 표시' : '👁️ 종료된 일정 숨기기'}</button>
        <button id="btn-add-personal" class="control-btn accent">➕ 개인 일정 추가</button>
        <button id="btn-clear-cache" class="control-btn secondary" title="장소 정보 캐시를 초기화하고 다시 불러옵니다">🗑️ 캐시 지우기</button>
      </div>
    `;
    calendarWrapper.appendChild(header);

    // 2. Calendar Cells Grid
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const SundayOfCurrentWeek = new Date(today);
    SundayOfCurrentWeek.setDate(today.getDate() - today.getDay());

    const startDate = new Date(SundayOfCurrentWeek);
    startDate.setDate(startDate.getDate() + (startOffsetWeeks * 7));

    const dayKorean = ['일', '월', '화', '수', '목', '금', '토'];

    for (let i = 0; i < CALENDAR_DAY_COUNT; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);

      const y = currentDate.getFullYear();
      const m = String(currentDate.getMonth() + 1).padStart(2, '0');
      const d = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      const isToday = currentDate.getTime() === today.getTime();
      const formattedDateText = `${currentDate.getMonth() + 1}월 ${currentDate.getDate()}일 (${dayKorean[currentDate.getDay()]})`;

      // Gather SOMA lectures for this day
      const dayLectures = lectures.filter(l => l.dateStr === dateStr);

      // Gather Personal schedules for this day
      const dayPersonal = mergedPersonalSchedules.filter(ps => ps.dateStr === dateStr);

      // Construct events array
      const allEvents = [];

      dayLectures.forEach(l => {
        let startKey = '00:00';
        const timeMatch = l.dateTimeText.match(/(\d{2}):(\d{2})/);
        if (timeMatch) startKey = `${timeMatch[1]}:${timeMatch[2]}`;
        
        allEvents.push({
          isPersonal: false,
          data: l,
          timeKey: startKey,
          ended: isLectureEnded(l.dateTimeText)
        });
      });

      dayPersonal.forEach(ps => {
        allEvents.push({
          isPersonal: true,
          data: ps,
          timeKey: ps.startTime,
          ended: isLectureEnded(`${ps.dateStr}(요일) ${ps.startTime} ~ ${ps.endTime}`)
        });
      });

      // Sort events chronologically
      allEvents.sort((a, b) => a.timeKey.localeCompare(b.timeKey));

      // Filter ended if hide option enabled
      const visibleEvents = hideEndedLectures
        ? allEvents.filter(e => !e.ended)
        : allEvents;

      // Skip rendering empty past cells to clean layout
      if (hideEndedLectures && currentDate < today && visibleEvents.length === 0) {
        continue;
      }

      const cell = document.createElement('div');
      cell.className = `calendar-cell${isToday ? ' today-bg' : ''}`;
      cell.setAttribute('data-calendar-date', dateStr);

      const dateHeader = document.createElement('div');
      dateHeader.className = 'calendar-date-header-row';

      const dateSpan = document.createElement('span');
      dateSpan.className = `calendar-date${isToday ? ' today-text' : ''}`;
      dateSpan.textContent = formattedDateText + (isToday ? ' [오늘]' : '');
      dateHeader.appendChild(dateSpan);

      const quickAddBtn = document.createElement('button');
      quickAddBtn.className = 'quick-add-cell-btn';
      quickAddBtn.innerHTML = '＋';
      quickAddBtn.title = '이 날짜에 개인 일정 추가';
      quickAddBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModalWithDate(dateStr);
      });
      dateHeader.appendChild(quickAddBtn);
      cell.appendChild(dateHeader);

      visibleEvents.forEach(evt => {
        if (evt.isPersonal) {
          // Render Personal Event Card
          const ps = evt.data;
          const card = document.createElement('div');
          card.className = `calendar-lecture ${evt.ended ? 'ended' : ''} event-personal`;
          card.title = ps.title;

          const badgeText = ps.isFixedShared ? '📌 공통 일정' : '👤 개인 일정';
          card.innerHTML = `
            <div class="info-group">
              <div class="text-title" data-role="title">${ps.title}</div>
              <div class="text-type-badge personal-badge">${badgeText}</div>
              <div class="info-row" data-role="time"><strong>시간</strong> ${ps.startTime} ~ ${ps.endTime}</div>
              ${ps.description ? `<div class="info-row desc-row" data-role="desc"><strong>메모</strong> ${ps.description}</div>` : ''}
            </div>
          `;

          if (ps.isFixedShared) {
            cell.appendChild(card);
            return;
          }

          const buttonGroup = document.createElement('div');
          buttonGroup.className = 'button-group';

          const btnEdit = document.createElement('button');
          btnEdit.className = 'edit-btn';
          btnEdit.innerHTML = '✏️ 수정';
          btnEdit.title = '개인 일정 수정';
          btnEdit.addEventListener('click', (e) => {
            e.preventDefault();
            openModalForEditing(ps);
          });

          const btnDelete = document.createElement('button');
          btnDelete.className = 'delete-btn';
          btnDelete.innerHTML = '🗑️ 삭제';
          btnDelete.title = '개인 일정 삭제';
          btnDelete.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm(`개인 일정 "${ps.title}"을(를) 삭제하시겠습니까?`)) {
              const currentList = await loadPersonalSchedules();
              const updatedList = currentList.filter(item => item.id !== ps.id);
              await new Promise(resolve => {
                chrome.storage.local.set({ soma_personal_schedules: updatedList }, resolve);
              });

              // Re-render
              const freshLectures = await parseLecturesTable();
              await syncSchedulesAfterLocalChange(freshLectures, updatedList);
              renderCalendar(freshLectures);
            }
          });

          buttonGroup.appendChild(btnEdit);
          buttonGroup.appendChild(btnDelete);
          card.appendChild(buttonGroup);
          cell.appendChild(card);
        } else {
          // Render SOMA Lecture Card
          const lec = evt.data;
          const card = document.createElement('div');
          card.className = `calendar-lecture ${evt.ended ? 'ended' : ''} ${lec.type.includes('특강') ? 'special' : 'mentoring'}`;
          card.title = lec.title;

          // Time clean format
          let timeStr = '';
          const timeMatch = lec.dateTimeText.match(/(\d{2}):(\d{2})(?::\d{2})?\s*~\s*(\d{2}):(\d{2})(?::\d{2})?/);
          if (timeMatch) {
            timeStr = `${timeMatch[1]}:${timeMatch[2]} ~ ${timeMatch[3]}:${timeMatch[4]}`;
          } else {
            timeStr = lec.dateTimeText;
          }

          const infoLink = document.createElement('a');
          infoLink.className = 'info-group';
          infoLink.href = lec.url || 'javascript:void(0);';
          infoLink.innerHTML = `
            <div class="text-title" data-role="title">${lec.title}</div>
            <div class="text-type-badge">${lec.type}</div>
            <div class="info-row" data-role="mentor"><strong>멘토</strong> ${lec.mentorName}</div>
            <div class="info-row" data-role="time"><strong>시간</strong> ${timeStr}</div>
            <div class="info-row" data-role="location"><strong>장소</strong> ${lec.location}</div>
            <div class="info-row" data-role="people"><strong>신청인원</strong> ${lec.people}</div>
            <div class="info-row" data-role="approval"><strong>개설승인</strong> ${lec.approvalStatus}</div>
            <div class="info-row" data-role="status"><strong>상태</strong> ${lec.deadlineStatus}</div>
          `;
          card.appendChild(infoLink);

          const buttonGroup = document.createElement('div');
          buttonGroup.className = 'button-group';
          const btnCancel = document.createElement('button');
          if (lec.hasCancelButton) {
            btnCancel.className = 'cancel-btn';
            btnCancel.innerHTML = '❌ 취소';
            btnCancel.title = '신청 취소';
            btnCancel.addEventListener('click', (e) => {
              e.preventDefault();
              triggerCancellation(lec.qustnrSn);
            });
          } else {
            btnCancel.className = 'cancel-btn unavailable';
            btnCancel.innerHTML = evt.ended ? '🚫 취소 불가' : '🔒 취소 불가';
            btnCancel.title = evt.ended ? '종료된 일정이므로 취소 불가' : '하루 전날부터는 취소 불가';
            btnCancel.disabled = true;
          }

          buttonGroup.appendChild(btnCancel);
          card.appendChild(buttonGroup);

          cell.appendChild(card);
        }
      });

      grid.appendChild(cell);
    }

    calendarWrapper.appendChild(grid);

    // Insert after tab selector list
    targetContainer.parentNode.insertBefore(calendarWrapper, targetContainer.nextSibling);

    // Event hooks
    document.getElementById('btn-prev-weeks').addEventListener('click', () => {
      startOffsetWeeks -= CALENDAR_SHIFT_WEEKS;
      renderCalendar(lectures);
    });

    const resetWeeksBtn = document.getElementById('btn-reset-weeks');
    if (resetWeeksBtn) {
      resetWeeksBtn.addEventListener('click', () => {
        startOffsetWeeks = 0;
        renderCalendar(lectures);
      });
    }

    document.getElementById('btn-toggle-ended').addEventListener('click', () => {
      hideEndedLectures = !hideEndedLectures;
      renderCalendar(lectures);
    });

    document.getElementById('btn-toggle-alarm').addEventListener('click', async () => {
      await toggleAlarmNotifications({
        lectures,
        onChanged: () => renderCalendar(lectures)
      });
    });

    document.getElementById('btn-add-personal').addEventListener('click', () => {
      openModalWithDate();
    });

    document.getElementById('btn-clear-cache').addEventListener('click', async () => {
      const allItems = await new Promise(resolve => chrome.storage.local.get(null, resolve));
      const keysToRemove = Object.keys(allItems).filter(k => k.startsWith('soma_lecture_detail_'));
      if (keysToRemove.length === 0) {
        alert('삭제할 캐시가 없습니다.');
        return;
      }
      await new Promise(resolve => chrome.storage.local.remove(keysToRemove, resolve));
      alert(`✅ 캐시 ${keysToRemove.length}개를 삭제했습니다. 페이지를 새로고침하면 장소 정보를 다시 불러옵니다.`);
    });
  }

  // --- DETAIL PAGE / CONFLICT RESOLUTION MODE ---

  function findLectureDateTimeOnDetailPage() {
    const groups = document.querySelectorAll('div.group');
    for (const group of groups) {
      const labelEl = group.querySelector('strong.t');
      const valueEl = group.querySelector('div.c');
      if (!labelEl || !valueEl) continue;

      const headerText = labelEl.textContent.trim();
      const valueText = valueEl.textContent.trim().replace(/\s+/g, ' ');

      if (headerText.includes('강의날짜') || headerText.includes('강의일시') || headerText.includes('교육일시')) {
        const match = parseLectureDateTimeText(valueText);
        if (match) {
          const { y, m, d, sh, sm, eh, em } = match;
          return `${y}-${m}-${d} ${sh.padStart(2, '0')}:${sm.padStart(2, '0')} ~ ${eh.padStart(2, '0')}:${em.padStart(2, '0')}`;
        }
      }
    }

    const ths = document.querySelectorAll('th');
    let dateStr = '';
    let timeStr = '';

    // Attempt 1: Search table rows with header labels
    for (const th of ths) {
      const headerText = th.textContent.trim();
      const td = th.nextElementSibling;
      if (!td) continue;
      const valueText = td.textContent.trim().replace(/\s+/g, ' ');

      if (headerText.includes('일시') || headerText.includes('강의일시') || headerText.includes('교육일시')) {
        const match = valueText.match(/(\d{4})[-./](\d{2})[-./](\d{2})(?:\([^)]+\))?\s*(\d{2}):(\d{2})/);
        if (match) return valueText;
      }
      
      if (headerText.includes('일자') || headerText.includes('날짜') || headerText.includes('교육일') || headerText.includes('강의일')) {
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
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      const match = text.match(/(\d{4})[-./](\d{2})[-./](\d{2})(?:\([^)]+\))?\s*(\d{2}):(\d{2})/);
      if (match) {
        return text;
      }
    }

    // Attempt 3: General search in body text
    const bodyText = document.body.innerText.replace(/\s+/g, ' ');
    const dateMatch = bodyText.match(/(\d{4})[-./](\d{2})[-./](\d{2})/);
    const timeMatch = bodyText.match(/(\d{2}):(\d{2})\s*~\s*(\d{2}):(\d{2})/);
    if (dateMatch && timeMatch) {
      return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]} ${timeMatch[0]}`;
    }

    return null;
  }

  function removeConflictBanners() {
    document.getElementById('soma-conflict-banner')?.remove();
    document.getElementById('soma-conflict-debug-banner')?.remove();
  }

  function findConflictBannerAnchor() {
    return (
      document.querySelector('#contentsList .mypage_renew.mypage_main > .inner') ||
      document.querySelector('#contentsList .inner') ||
      document.getElementById('contentsList') ||
      document.getElementById('pageStart') ||
      null
    );
  }

  function getPersonalScheduleManageUrl() {
    const path = window.location.pathname;
    const basePath = path.includes('/busan/sw/') ? '/busan/sw' : '/sw';
    return `${window.location.origin}${basePath}/mypage/userAnswer/history.do?menuNo=200047`;
  }

  function injectWarningBanner(schedule, detailText = '') {
    const existing = document.getElementById('soma-conflict-banner');
    if (existing) existing.remove();
    
    const banner = document.createElement('div');
    banner.id = 'soma-conflict-banner';
    banner.innerHTML = `
      <div class="conflict-icon">⚠️</div>
      <div class="conflict-content">
        <div class="conflict-title">개인 일정과 겹치는 멘토링입니다.</div>
        <div class="conflict-desc">
          이 강의 시간은 개인 일정 <strong>"${schedule.title}"</strong> (${schedule.startTime} ~ ${schedule.endTime})과 중복되므로 신청할 수 없습니다.
        </div>
        <div class="conflict-help">멘토링을 신청하시려면 일정을 변경하세요.</div>
        ${detailText ? `<div class="conflict-meta">${detailText}</div>` : ''}
        <div class="conflict-actions">
          <a class="conflict-link-btn" href="${getPersonalScheduleManageUrl()}">개인 일정 수정하기</a>
        </div>
      </div>
    `;

    const anchor = findConflictBannerAnchor();
    if (!anchor) return;

    if (anchor.firstChild) {
      anchor.insertBefore(banner, anchor.firstChild);
    } else {
      anchor.appendChild(banner);
    }
  }

  function blockApplication(conflictingSchedule, detailText = '') {
    console.log('SOMA Schedule Manager: blockApplication started.');
    // Collect possible apply triggers
    const applyElements = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a'));
    const targetElements = applyElements.filter(el => {
      const text = (el.textContent || el.value || '').trim();
      const onclickAttr = el.getAttribute('onclick') || '';
      return text.includes('신청') || text.includes('접수') || onclickAttr.includes('checkApply') || onclickAttr.includes('checkMento');
    });
    console.log('SOMA Schedule Manager: Target elements found to block:', targetElements);

    targetElements.forEach(el => {
      if (!el.parentNode) return;
      
      // Clone the element to strip all page event listeners (jQuery, etc.)
      const clone = el.cloneNode(true);
      
      if (clone.tagName === 'INPUT' || clone.tagName === 'BUTTON') {
        clone.disabled = true;
      }
      
      // Override styles to signal disabled state
      clone.classList.add('soma-conflict-disabled');
      clone.style.opacity = '0.5';
      clone.style.cursor = 'not-allowed';
      clone.removeAttribute('onclick'); // Remove inline onclick handler
      clone.removeAttribute('href');
      
      // Extra protection capture handler
      clone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        alert(`⚠️ 개인 일정 "${conflictingSchedule.title}"와 시간이 중복되어 신청할 수 없습니다.`);
      }, true);
      
      el.parentNode.replaceChild(clone, el);
      console.log('SOMA Schedule Manager: Replaced element with blocked clone:', el, clone);
    });

    injectWarningBanner(conflictingSchedule, detailText);
  }

  async function checkLectureConflict() {
    console.log('SOMA Schedule Manager: Starting conflict check...');
    const dateTimeText = findLectureDateTimeOnDetailPage();
    console.log('SOMA Schedule Manager: findLectureDateTimeOnDetailPage returned:', dateTimeText);
    if (!dateTimeText) {
      console.log('SOMA Schedule Manager: No lecture date-time string found on detail page.');
      return;
    }
    
    const match = parseLectureDateTimeText(dateTimeText);
    console.log('SOMA Schedule Manager: Regex match result:', match);
    if (!match) return;
    
    const { y, m, d, sh, sm, eh, em } = match;
    const lectureStart = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(sh, 10), parseInt(sm, 10), 0);
    const lectureEnd = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(eh, 10), parseInt(em, 10), 0);
    console.log('SOMA Schedule Manager: Parsed Lecture bounds:', lectureStart, 'to', lectureEnd);
    const detailText = `멘토링 시간: ${dateTimeText}`;
    
    // Load personal schedules
    const personalSchedules = await new Promise(resolve => {
      chrome.storage.local.get(['soma_personal_schedules'], (res) => {
        resolve(res.soma_personal_schedules || []);
      });
    });
    console.log('SOMA Schedule Manager: Loaded personal schedules:', personalSchedules);

    // Evaluate overlaps
    let conflictingSchedule = null;
    for (const ps of personalSchedules) {
      if (!ps?.dateStr || !ps?.startTime || !ps?.endTime) continue;

      const [py, pm, pd] = ps.dateStr.split('-');
      const [psh, psm] = ps.startTime.split(':');
      const [peh, pem] = ps.endTime.split(':');
      
      const personalStart = new Date(parseInt(py, 10), parseInt(pm, 10) - 1, parseInt(pd, 10), parseInt(psh, 10), parseInt(psm, 10), 0);
      const personalEnd = new Date(parseInt(py, 10), parseInt(pm, 10) - 1, parseInt(pd, 10), parseInt(peh, 10), parseInt(pem, 10), 0);
      
      const isOverlap = lectureStart < personalEnd && personalStart < lectureEnd;
      console.log(`SOMA Schedule Manager: Comparing with "${ps.title}" (${personalStart} ~ ${personalEnd}) -> Overlap: ${isOverlap}`);
      
      if (isOverlap) {
        conflictingSchedule = ps;
        break;
      }
    }
    
    if (conflictingSchedule) {
      console.warn(`SOMA Schedule Manager: Overlap detected with personal schedule "${conflictingSchedule.title}"`);
      blockApplication(conflictingSchedule, detailText);
    } else {
      removeConflictBanners();
      console.log('SOMA Schedule Manager: No scheduling conflict detected.');
    }
  }

  // Wrap checking logic with DOM retries for dynamically loaded contents
  async function checkLectureConflictWithRetry() {
    console.log('SOMA Schedule Manager: Initializing conflict check with retry loop...');
    let retries = 10;
    while (retries > 0) {
      const dateTimeText = findLectureDateTimeOnDetailPage();
      const applyBtn = document.querySelector('button, input[type="submit"], input[type="button"], a.btn');
      
      if (dateTimeText && applyBtn) {
        console.log('SOMA Schedule Manager: Target DOM elements resolved.');
        await checkLectureConflict();
        return;
      }
      
      console.log(`SOMA Schedule Manager: Waiting for page content (retries remaining: ${retries})...`);
      await new Promise(resolve => setTimeout(resolve, 300));
      retries--;
    }
    
    // Fallback trigger
    await checkLectureConflict();
  }

  // --- ENTRY ROUTING ---

  async function init() {
    const path = window.location.pathname;
    
    // Routing based on path
    if (path.includes('/mypage/userAnswer/history.do') || path.includes('/mypage/mentoLec/history.do')) {
      try {
        injectModalDOM();
        const lectures = await parseLecturesTable();
        renderCalendar(lectures);
        await syncSchedulesOnHistoryPageLoadIfConfigured(lectures);
      } catch (e) {
        console.error('Failed to initialize history dashboard:', e);
      }
    }
    else if (path.includes('/mypage/mentoLec/view.do')) {
      try {
        await checkLectureConflictWithRetry();

        const observer = new MutationObserver(() => {
          checkLectureConflictWithRetry().catch(e => {
            console.error('Failed to re-run scheduling conflict checker:', e);
          });
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      } catch (e) {
        console.error('Failed to run scheduling conflict checker:', e);
      }
    }
  }

  // DOM ready check
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
