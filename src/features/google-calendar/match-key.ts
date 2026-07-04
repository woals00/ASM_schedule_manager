// Stable key correlating a lecture to its Google Calendar match result.
//
// Active lectures key by their SOMA id (strict qustnrSn match). Mentor-deleted
// lectures have lost their id in the registration-history DOM, so they key by
// title + date + start time — the only correlation left. The server-side matcher
// matches those looser, with an active-id exclusion guard against re-registrations.
//
// Pure (no chrome deps) so both the service worker matcher and the content-script
// calendar can compute identical keys.
export function lectureMatchKey(
  somaLectureId: string,
  title: string,
  dateStr: string,
  startTime: string,
): string {
  return somaLectureId || `del:${title}|${dateStr}|${startTime}`;
}
