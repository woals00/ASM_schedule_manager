// Conflict banner — replaces the innerHTML version in conflict-banner.ts.
// One component, two variants ('mentoring' = block, 'reoffer' = re-offer notice).

import { cx } from '@shared/ui/cx';
import { Icon } from '@shared/ui/Icon';
import styles from './ConflictBanner.module.css';
import css from './ConflictBanner.module.css?inline';

export const conflictBannerCss = css;

export type ConflictBannerVariant = 'mentoring' | 'reoffer';

export interface ConflictBannerProps {
  variant: ConflictBannerVariant;
  mentoringTime: string;
  conflictTitle: string;
  conflictStart: string;
  conflictEnd: string;
}

const COPY = {
  mentoring: {
    title: '멘토링 일정과 중복되는 멘토링입니다',
    desc: '이미 접수한 멘토링 일정과 시간대가 겹쳐 신청이 제한됩니다. 기존 접수를 취소하거나 다른 멘토링을 선택해 주세요.',
    conflictLabel: '기존 멘토링 시간',
  },
  reoffer: {
    title: '이미 신청한 동일 멘토링입니다',
    desc: '같은 이름의 멘토링을 이미 신청했습니다. 멘토특강이 자유멘토링으로 다시 개설되는 등 같은 강의가 재개설된 경우일 수 있어 신청은 가능합니다. 기존 신청이 자동 전환·취소되는지 확인한 뒤 신청해 주세요.',
    conflictLabel: '기존 신청 멘토링',
  },
} as const;

export function ConflictBanner({
  variant,
  mentoringTime,
  conflictTitle,
  conflictStart,
  conflictEnd,
}: ConflictBannerProps) {
  const copy = COPY[variant];

  return (
    <div
      className={cx(styles.banner, {
        [styles.bannerMentoring]: variant === 'mentoring',
        [styles.bannerReoffer]: variant === 'reoffer',
      })}
    >
      <div className={styles.bannerIcon}>
        <Icon name="alertTriangle" size={24} />
      </div>
      <div className={styles.bannerContent}>
        <div className={styles.bannerTitle}>{copy.title}</div>
        <div className={styles.bannerDesc}>{copy.desc}</div>

        <div className={styles.bannerTimeline}>
          <div className={styles.bannerRows}>
            <div className={styles.bannerRow}>
              <span className={cx(styles.bannerLabel, styles.bannerLabelMentoring)}>
                아래 멘토링 시간
              </span>
              <span className={styles.bannerValue}>{mentoringTime}</span>
            </div>
            <div className={styles.bannerRow}>
              <span className={cx(styles.bannerLabel, styles.bannerLabelPersonal)}>
                {copy.conflictLabel}
              </span>
              <span className={styles.bannerValue}>
                <strong className={styles.bannerValueTitle}>"{conflictTitle}"</strong>
                <span className={styles.bannerValueTime}>
                  ({conflictStart} ~ {conflictEnd})
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
