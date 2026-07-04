// Google Calendar match orchestration for the dashboard calendar. Owns the
// match state, the "just registered" feedback pulse, and the focus/visibility
// re-sync that refreshes the match when the user returns from Google Calendar.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MentoringSchedule } from '@features/schedules/mentoring-schedule';
import { lectureMatchKey } from '@features/google-calendar/match-key';
import type { GoogleCalendarMatchResponse } from './CalendarCell';

const GOOGLE_CALENDAR_OPENED_EVENT = 'asm:google-calendar-opened';
const GOOGLE_CALENDAR_RETURN_RETRY_DELAYS_MS = [0, 2000, 5000];
const GOOGLE_CALENDAR_REGISTERED_FEEDBACK_MS = 3200;

async function requestGoogleCalendarMatch(
  schedules: MentoringSchedule[],
): Promise<GoogleCalendarMatchResponse> {
  // Mentor-deleted lectures lost their id but still carry title/date/time, so
  // they're matched by those instead — let them through without a somaLectureId.
  const valid = schedules.filter(
    (s) => s.dateStr && s.startTime && s.endTime && (s.somaLectureId || s.title),
  );
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'asm-google-calendar-match',
      lectures: valid,
    });
    if (response && typeof response === 'object' && 'connected' in response) {
      return response as GoogleCalendarMatchResponse;
    }
    console.warn('[ASM Google Calendar] match response had unexpected shape', response);
  } catch (err) {
    console.warn('[ASM Google Calendar] match failed:', err);
  }
  return { connected: false, matched: {} };
}

async function requestFreshGoogleCalendarMatch(
  schedules: MentoringSchedule[],
): Promise<GoogleCalendarMatchResponse> {
  try {
    await chrome.runtime.sendMessage({ type: 'asm-google-calendar-clear-cache' });
  } catch {
    // Best-effort: a normal match still works if cache clearing fails.
  }
  return requestGoogleCalendarMatch(schedules);
}

export interface GoogleCalendarMatchState {
  googleCalendarMatch: GoogleCalendarMatchResponse;
  registeredFeedbackIds: Set<string>;
  deletedFromGoogleFeedbackIds: Set<string>;
}

export function useGoogleCalendarMatch(
  mentoringSchedules: MentoringSchedule[],
  loading: boolean,
  mentorDeletedKeys: Set<string>,
  onDeletedFromGoogleSettled?: (keys: string[]) => void,
): GoogleCalendarMatchState {
  const [googleCalendarMatch, setGoogleCalendarMatch] = useState<GoogleCalendarMatchResponse>({
    connected: false,
    matched: {},
  });
  const [registeredFeedbackIds, setRegisteredFeedbackIds] = useState<Set<string>>(new Set());
  const [deletedFromGoogleFeedbackIds, setDeletedFromGoogleFeedbackIds] = useState<Set<string>>(
    new Set(),
  );
  const mentoringSchedulesRef = useRef<MentoringSchedule[]>([]);
  const mentorDeletedKeysRef = useRef<Set<string>>(new Set());
  const onDeletedSettledRef = useRef<((keys: string[]) => void) | undefined>(undefined);
  const googleCalendarMatchRef = useRef<GoogleCalendarMatchResponse>({
    connected: false,
    matched: {},
  });
  const feedbackTimersRef = useRef<number[]>([]);

  useEffect(() => {
    mentoringSchedulesRef.current = mentoringSchedules;
  }, [mentoringSchedules]);

  useEffect(() => {
    mentorDeletedKeysRef.current = mentorDeletedKeys;
  }, [mentorDeletedKeys]);

  useEffect(() => {
    onDeletedSettledRef.current = onDeletedFromGoogleSettled;
  }, [onDeletedFromGoogleSettled]);

  /**
   * 매칭 결과를 상태에 반영하고 전환을 두 방향으로 감지해 3.2초 펄스를 띄운다:
   * - 미매칭→매칭: "방금 등록됨"(등록완료!) 피드백.
   * - 매칭→미매칭(단, 멘토 삭제된 강의 한정): "구글 캘린더에서 삭제됨!" 피드백.
   *   펄스가 끝나면 onDeletedFromGoogleSettled 로 알려 카드를 영구 숨김 처리하게 한다.
   */
  const applyGoogleCalendarMatch = useCallback((next: GoogleCalendarMatchResponse) => {
    const previous = googleCalendarMatchRef.current;
    const keys = mentoringSchedulesRef.current
      .map((s) => lectureMatchKey(s.somaLectureId, s.title, s.dateStr, s.startTime))
      .filter(Boolean);

    const completedKeys = keys.filter(
      (k) => previous.connected && !previous.matched[k] && next.connected && next.matched[k],
    );
    const deletedKeys = keys.filter(
      (k) =>
        previous.connected &&
        previous.matched[k] &&
        next.connected &&
        !next.matched[k] &&
        mentorDeletedKeysRef.current.has(k),
    );

    googleCalendarMatchRef.current = next;
    setGoogleCalendarMatch(next);

    if (completedKeys.length > 0) {
      setRegisteredFeedbackIds((prev) => {
        const merged = new Set(prev);
        completedKeys.forEach((k) => merged.add(k));
        return merged;
      });

      const timer = window.setTimeout(() => {
        setRegisteredFeedbackIds((prev) => {
          const nextIds = new Set(prev);
          completedKeys.forEach((k) => nextIds.delete(k));
          return nextIds;
        });
      }, GOOGLE_CALENDAR_REGISTERED_FEEDBACK_MS);
      feedbackTimersRef.current.push(timer);
    }

    if (deletedKeys.length > 0) {
      setDeletedFromGoogleFeedbackIds((prev) => {
        const merged = new Set(prev);
        deletedKeys.forEach((k) => merged.add(k));
        return merged;
      });

      const timer = window.setTimeout(() => {
        setDeletedFromGoogleFeedbackIds((prev) => {
          const nextIds = new Set(prev);
          deletedKeys.forEach((k) => nextIds.delete(k));
          return nextIds;
        });
        onDeletedSettledRef.current?.(deletedKeys);
      }, GOOGLE_CALENDAR_REGISTERED_FEEDBACK_MS);
      feedbackTimersRef.current.push(timer);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    void requestGoogleCalendarMatch(mentoringSchedules).then(applyGoogleCalendarMatch);
  }, [applyGoogleCalendarMatch, loading, mentoringSchedules]);

  useEffect(() => {
    if (loading) return;

    let pending = false;
    let syncVersion = 0;
    const timers: number[] = [];

    const clearTimers = () => {
      while (timers.length > 0) {
        const timer = timers.pop();
        if (timer !== undefined) window.clearTimeout(timer);
      }
    };

    const runPendingSync = () => {
      if (!pending || document.visibilityState === 'hidden') return;
      pending = false;
      syncVersion += 1;
      const currentSync = syncVersion;
      let latestAppliedAttempt = -1;
      clearTimers();

      GOOGLE_CALENDAR_RETURN_RETRY_DELAYS_MS.forEach((delay, attemptIndex) => {
        const timer = window.setTimeout(() => {
          if (currentSync !== syncVersion) return;
          void requestFreshGoogleCalendarMatch(mentoringSchedulesRef.current).then((next) => {
            if (currentSync !== syncVersion || attemptIndex < latestAppliedAttempt) return;
            latestAppliedAttempt = attemptIndex;
            applyGoogleCalendarMatch(next);
          });
        }, delay);
        timers.push(timer);
      });
    };

    const handleGoogleCalendarOpened = () => {
      pending = true;
    };

    window.addEventListener(GOOGLE_CALENDAR_OPENED_EVENT, handleGoogleCalendarOpened);
    window.addEventListener('focus', runPendingSync);
    document.addEventListener('visibilitychange', runPendingSync);

    return () => {
      syncVersion += 1;
      clearTimers();
      window.removeEventListener(GOOGLE_CALENDAR_OPENED_EVENT, handleGoogleCalendarOpened);
      window.removeEventListener('focus', runPendingSync);
      document.removeEventListener('visibilitychange', runPendingSync);
    };
  }, [applyGoogleCalendarMatch, loading]);

  useEffect(() => {
    return () => {
      feedbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return { googleCalendarMatch, registeredFeedbackIds, deletedFromGoogleFeedbackIds };
}
