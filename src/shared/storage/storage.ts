// chrome.storage.local helpers shared by mentoLec and mentoring registration history entries.

export function hasChromeLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

export function readChromeStorage(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (!hasChromeLocalStorage()) {
      resolve({});
      return;
    }

    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime?.lastError) {
        resolve({});
        return;
      }

      resolve(result || {});
    });
  });
}

export function writeChromeStorage(obj: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!hasChromeLocalStorage()) {
      reject(new Error('브라우저 로컬 저장소를 사용할 수 없습니다.'));
      return;
    }

    chrome.storage.local.set(obj, () => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message || '브라우저 로컬 저장소 저장에 실패했습니다.'));
        return;
      }

      resolve();
    });
  });
}

export function removeChromeStorage(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (!hasChromeLocalStorage()) {
      resolve();
      return;
    }

    chrome.storage.local.remove(keys, () => {
      resolve();
    });
  });
}
