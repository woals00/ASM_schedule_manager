/**
 * 강의 취소를 트리거한다. 전용 API 가 없어 SOMA 표에서 해당 행의 delDate 링크를
 * 찾아 프로그램적으로 클릭한다. 링크를 못 찾으면 수동 취소를 안내하는 alert 를 띄운다.
 * delDate 는 onclick 이 아니라 href="javascript:delDate(...)" 에 있다.
 */
export function triggerCancellation(somaLectureId: string): void {
  const rows = document.querySelectorAll('.boardlist table tbody tr');
  for (const row of rows) {
    const a = row.querySelector<HTMLAnchorElement>('.tit.popuser a');
    if (a && (a.getAttribute('href') || '').includes(`qustnrSn=${somaLectureId}`)) {
      const delBtn = row.querySelector<HTMLElement>('a[href*="delDate"], a[onclick*="delDate"]');
      if (delBtn) {
        delBtn.click();
        return;
      }
    }
  }
  alert('접수 취소 처리기(delDate)를 찾을 수 없습니다. 원래 표에서 취소 버튼을 눌러주십시오.');
}
