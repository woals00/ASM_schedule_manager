// Persisted set of mentor-deleted lecture match-keys the user has cleaned out of
// their Google Calendar. Hidden from the dashboard permanently so the leftover
// doesn't reappear after a reload (the SOMA row stays "강의 삭제됨" forever otherwise).
// Keys are lectureMatchKey() values (title+date+start for id-less deleted rows).

import { readChromeStorage, writeChromeStorage } from '@shared/storage/storage';

const STORAGE_KEY = 'soma_dismissed_deleted_lectures';

export async function loadDismissedDeletedLectureKeys(): Promise<Set<string>> {
  const res = await readChromeStorage([STORAGE_KEY]);
  const keys = res[STORAGE_KEY];
  return new Set(Array.isArray(keys) ? keys.filter((x): x is string => typeof x === 'string') : []);
}

export async function addDismissedDeletedLectureKeys(keys: string[]): Promise<void> {
  const current = await loadDismissedDeletedLectureKeys();
  keys.forEach((k) => current.add(k));
  await writeChromeStorage({ [STORAGE_KEY]: [...current] });
}

export async function removeDismissedDeletedLectureKeys(keys: string[]): Promise<void> {
  const current = await loadDismissedDeletedLectureKeys();
  keys.forEach((k) => current.delete(k));
  await writeChromeStorage({ [STORAGE_KEY]: [...current] });
}
