export interface LocationInfo {
  type: 'online' | 'offline';
  label: string;
}

export function classifyLocation(text: string | null | undefined): LocationInfo | null {
  if (!text) return null;

  const t = text.trim();
  if (!t) return null;

  if (t.includes('온라인') || /zoom|meet|teams|webex/i.test(t)) {
    return { type: 'online', label: '온라인' };
  }

  return { type: 'offline', label: '오프라인' };
}
