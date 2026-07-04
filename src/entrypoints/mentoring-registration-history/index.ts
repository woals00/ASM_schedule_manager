// SOMA Schedule Manager - Schedule Manager Script
// Automatically parses registration tables, renders a calendar, and runs the
// detail-page conflict checker.

import { checkLectureConflictWithRetry } from '@features/conflict-check/detail-page-conflict';
import { renderCalendar, renderCalendarSkeleton } from '@features/mentoring-registration-history/calendar/calendar';
import { parseLecturesTable } from '@features/mentoring-registration-history/lectures/lecture-table';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init(): Promise<void> {
  const path = window.location.pathname;

  if (path.includes('/mypage/userAnswer/history.do') || path.includes('/mypage/mentoLec/history.do')) {
    try {
      // 강의 상세 fetch가 직렬이라 콜드 캐시면 N건만큼 대기 시간이 길어진다.
      // 헤더+로딩 placeholder를 먼저 그려서 사용자에게 진행 중임을 알린다.
      renderCalendarSkeleton();
      const lectures = await parseLecturesTable();
      await renderCalendar(lectures);
    } catch (e) {
      console.error('Failed to initialize mentoring registration history dashboard:', e);
    }
  } else if (path.includes('/mypage/mentoLec/view.do')) {
    try {
      let conflictCheckTimer: ReturnType<typeof setTimeout> | null = null;
      let conflictCheckRunning = false;

      const runConflictCheck = async () => {
        if (conflictCheckRunning) return;
        conflictCheckRunning = true;
        try {
          await checkLectureConflictWithRetry();
        } catch (e) {
          console.error('Failed to re-run scheduling conflict checker:', e);
        } finally {
          conflictCheckRunning = false;
        }
      };

      await runConflictCheck();

      const observer = new MutationObserver(() => {
        if (conflictCheckTimer) clearTimeout(conflictCheckTimer);
        conflictCheckTimer = setTimeout(runConflictCheck, 500);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.error('Failed to run scheduling conflict checker:', e);
    }
  }
}
