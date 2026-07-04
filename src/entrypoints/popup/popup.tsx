// Extension popup — Google Calendar connect/disconnect UI. Entry point loaded
// from popup.html; mounts a React root into #root.

import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from '@shared/ui/Icon';
import { cx } from '@shared/ui/cx';
import styles from './popup.module.css';

interface GoogleCalendarStatusResponse {
  connected: boolean;
}

interface GoogleCalendarConnectResponse {
  connected: boolean;
  error?: string;
}

function sendBackgroundMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || 'Background message failed.'));
        return;
      }
      resolve(response as T);
    });
  });
}

type Status = 'loading' | 'connected' | 'disconnected';

function Popup() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await sendBackgroundMessage<GoogleCalendarStatusResponse>({
          type: 'asm-google-calendar-status',
        });
        setStatus(res.connected ? 'connected' : 'disconnected');
      } catch (err) {
        setStatus('disconnected');
        setError(err instanceof Error ? err.message : '상태를 확인할 수 없습니다.');
      }
    })();
  }, []);

  const handleConnect = useCallback(async () => {
    setError(null);
    setBusyLabel('인증 중…');
    try {
      const res = await sendBackgroundMessage<GoogleCalendarConnectResponse>({
        type: 'asm-google-calendar-connect',
      });
      if (res.connected) {
        setStatus('connected');
      } else {
        setStatus('disconnected');
        if (res.error) setError(res.error);
      }
    } catch (err) {
      setStatus('disconnected');
      setError(err instanceof Error ? err.message : '연동 중 오류가 발생했습니다.');
    } finally {
      setBusyLabel(null);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setError(null);
    setBusyLabel('해제 중…');
    try {
      await sendBackgroundMessage({ type: 'asm-google-calendar-disconnect' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '연결 해제 중 오류가 발생했습니다.');
    } finally {
      setStatus('disconnected');
      setBusyLabel(null);
    }
  }, []);

  return (
    <div className={styles.container}>
      <h1>소마 멘토링 캘린더</h1>
      <section className={styles.googleCalendarSection}>
        <div className={styles.sectionTitle}>구글 캘린더 연동</div>

        {status === 'loading' && (
          <div className={cx(styles.statusRow, styles.statusLoading)}>
            <span className={styles.statusText}>상태 확인 중…</span>
          </div>
        )}

        {status === 'connected' && (
          <>
            <div className={cx(styles.statusRow, styles.statusConnected)}>
              <span className={styles.statusText}>
                <Icon name="check" size={14} />
                <span>연동됨</span>
              </span>
            </div>
            <div>
              <button
                type="button"
                className={cx(styles.button, styles.buttonSecondary)}
                disabled={busyLabel !== null}
                onClick={() => void handleDisconnect()}
              >
                {busyLabel ?? '연결 해제'}
              </button>
            </div>
          </>
        )}

        {status === 'disconnected' && (
          <>
            <div className={cx(styles.statusRow, styles.statusDisconnected)}>
              <span className={styles.statusText}>연동되지 않음</span>
            </div>
            <div>
              <button
                type="button"
                className={cx(styles.button, styles.buttonPrimary)}
                disabled={busyLabel !== null}
                onClick={() => void handleConnect()}
              >
                {busyLabel ?? (
                  <>
                    <Icon name="calendarDays" size={14} />
                    <span>연동하기</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {error && <div className={styles.errorRow}>{error}</div>}

        <p className={styles.help}>
          연동하면 접수내역 캘린더에서 아직 구글 캘린더에 등록하지 않은 강의를 하이라이트합니다.
        </p>
      </section>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Popup />);
}
