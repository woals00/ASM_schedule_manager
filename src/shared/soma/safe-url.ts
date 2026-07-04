/**
 * 신뢰 도메인(https, *.swmaestro.ai/org)인 SOMA URL 만 통과시키는 화이트리스트 가드.
 * 상대 경로는 현재 origin 기준으로 해석한다.
 * @param url 검증할 URL (상대/절대, nullish 허용)
 * @returns 통과 시 절대 URL, 그 외엔 빈 문자열
 */
export function getSafeSomaUrl(url: string | undefined | null): string {
  try {
    const parsed = new URL(url || '', window.location.origin);
    if (parsed.protocol === 'https:' && /(^|\.)swmaestro\.(ai|org)$/i.test(parsed.hostname)) {
      return parsed.toString();
    }
  } catch (_) {
    /* ignore */
  }
  return '';
}
