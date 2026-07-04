# ASM Schedule Manager

소프트웨어 마에스트로(AI·SW Maestro) 마이페이지 일정을 더 편하게 확인하고 관리할 수 있는 Chrome 확장 프로그램입니다.

## 원본 레포와의 차이점

이 레포는 [woals00/ASM_schedule_manager](https://github.com/woals00/ASM_schedule_manager) 의 `7e79490` (Polish history schedule interactions) 시점에서 분기했습니다. 이후 다음 변경이 추가됐습니다.

### 새 기능
- **Google Calendar 연동** — `chrome.identity` OAuth 로 본인 Google 캘린더를 조회해, 아직 등록하지 않은 멘토링/특강 카드를 호박색 테두리와 `미등록` 리본으로 하이라이트합니다. (SOMA 강의 ID 정확 매칭)<br>
<img width="160" alt="image" src="https://github.com/user-attachments/assets/c9c4fe05-f917-4513-b0ff-2c148211a360" /><br>
<img width="160" alt="image" src="https://github.com/user-attachments/assets/cea20768-8fab-479f-ae5c-d075584bbbb2" /><br>
- **로컬 캘린더 익스포트** — 각 일정을 Google Calendar 등록 링크 또는 RFC 5545 `.ics` 파일로 내려받아 다른 캘린더에 import 할 수 있습니다. (서버 없이 클라이언트에서만 동작)<br>
<img width="150" alt="image" src="https://github.com/user-attachments/assets/b6eb0c72-62c7-4391-b663-0515c063b20d" /><br>
- **접수 내역 새로고침 버튼** — 강의 상세·캘린더 캐시를 비우고 즉시 재파싱합니다. (방금 신청한 내역이 아직 반영되지 않았을 때 유용)<br>
<img width="150" alt="image" src="https://github.com/user-attachments/assets/e598bb95-930b-4e79-8c92-fdc85833030d" /><br>
- **단계별 로딩 표시 + 오늘 우선 fetch** — 자유 멘토링 패널 헤더에 현재 단계(`강의 목록 동기화 중…`, `장소 정보 가져오는 중… (N/M)`)와 진행도를 표시합니다. 강의 상세 fetch 순서를 오늘 → 미래 일자 순으로 정렬해, 먼저 보는 정보가 먼저 캐시에 채워지도록 했습니다. 정원·마감 정보를 불러오는 동안에도 이미 받아온 강의는 배치마다 즉시 카드로 반영됩니다.<br>
<img width="400" alt="스크린샷 2026-06-01 233953" src="https://github.com/user-attachments/assets/43e54eec-74dc-4e82-a2bb-5c4241d9b865" /><br>
<img width="400" alt="스크린샷 2026-06-01 234306" src="https://github.com/user-attachments/assets/40e34311-1558-4506-ad39-5a532f7cf33f" /><br>
- **접수 내역 로딩 스켈레톤** — 콜드 캐시 첫 로딩 시 헤더+스피너 placeholder 를 즉시 렌더해 빈 화면 대기 시간을 없앴습니다.<br>
<img width="420" alt="스크린샷 2026-06-01 223331" src="https://github.com/user-attachments/assets/f92cab58-7257-4b77-bab4-d34df0029ae9" /><br>
- **확장 아이콘 추가**.
### 버그 수정
- 멘토가 삭제한 강의(`삭제` 표시)가 접수 내역 캘린더에 `로딩 중…` 카드로 잔존하던 문제를 수정했습니다.
- Google Calendar 매칭 false positive 제거 — 시간만 겹쳐도 매칭되던 fallback 을 없애고 SOMA 강의 ID 정확 매칭만 사용합니다.
- 확장 ID 를 manifest `key` 로 고정 — 개발 PC 가 바뀌어도 동일한 ID 가 유지돼 Google OAuth client 바인딩이 깨지지 않습니다.
### 내부 구조 변경
- **Vite + TypeScript 빌드로 전환** — 기존 단일 `.js` 파일들을 모듈로 분할하고 산출물을 `dist/` 로 빌드합니다. 전체 소스(background · calendar-export · content · schedule-manager)를 TypeScript 로 마이그레이션했습니다.
- **모듈 구조 재편** — manifest 가 직접 로드하는 코드는 `src/entrypoints/`, 기능 단위 구현은 `src/features/`, 공용 UI·DOM·스토리지·날짜 유틸은 `src/shared/` 로 분리했습니다.
- **React + Shadow DOM 도입** — 충돌 배너 · 접수 내역 캘린더 · 자유 멘토링 보드 · 확장 팝업을 명령형 `innerHTML` 에서 React 컴포넌트로 재작성했습니다. UI 를 Shadow DOM 안에 마운트하고 CSS 를 `?inline` 으로 주입해 SOMA 페이지 스타일과 양방향으로 격리하며, 이후 각 컴포넌트를 파일 단위로 나누고 CSS 를 컴포넌트 옆에 co-locate 했습니다.
- **UI 이모지 → Lucide 아이콘(SVG)** — 폰트·플랫폼별 이모지 렌더링 불일치를 제거했습니다.
- **알림(Discord/Cloudflare) 기능 제거** — 원본의 알림 파이프라인을 삭제했습니다. 비활성 플래그로 남아 있던 `alarm-sync` 모듈과 관련 UI·`worker-fetch` 프록시·해당 host 권한을 모두 정리해, 이제 캘린더/익스포트 기능만 남았습니다.
- **공유 모듈 통합 · 컴포넌트 분할** — 중복 로직(일정 충돌 검사 · KST 날짜 변환 · SOMA 상세 페이지 파싱)을 `src/shared/` 로 모으고, 대형 컴포넌트(자유 멘토링 보드 · 접수 내역 캘린더)를 하위 컴포넌트와 커스텀 훅으로 분리했습니다.
- **명시적 버전 관리** — `package.json` 의 version 을 `dist/manifest.json` 에 주입하되, `npm run build` 는 patch 버전을 자동으로 올리지 않습니다.

---

## 프로젝트 구조

```
src/
├── manifest.json
├── entrypoints/   manifest 가 직접 로드하는 진입점 (content script · service worker · popup)
├── features/      기능 단위 구현
│   ├── mentoring-board/                   자유 멘토링 / 멘토 특강 보드
│   ├── mentoring-registration-history/    접수 내역 캘린더 · 강의 상세
│   ├── conflict-check/                     상세 페이지 신청 중복 감지 배너
│   ├── schedules/                          일정 데이터 · 충돌 판정 로직
│   ├── calendar-export/                    Google Calendar 링크 · .ics 익스포트
│   └── google-calendar/                    service worker 측 Google Calendar 매칭
└── shared/        기능 간 공용 유틸 (date · soma · storage · dom · ui · html)
```

빌드는 Vite + `vite-plugin-web-extension` 으로 수행되며 산출물은 `dist/` 에 생성됩니다 (gitignore).

---

## 사용 방법

1. 저장소를 로컬에 복제합니다.

```bash
git clone https://github.com/leeve1247/ASM_schedule_manager.git
cd ASM_schedule_manager
```

2. 의존성을 설치하고 빌드합니다.

```bash
npm install
npm run build
```

> `npm run build` 가 **성공한 뒤** `package.json` 의 patch 버전이 자동으로 1 증가합니다 (예: `0.0.1` → `0.0.2`). 즉, 이번 빌드 산출물(`dist/manifest.json`)에는 빌드 직전 버전이 들어가고, 증가한 새 버전은 *다음* 빌드용으로 예약됩니다. tsc 나 vite 가 중간에 실패하면 버전은 올라가지 않아 실패한 빌드가 번호를 낭비하지 않습니다.

3. Chrome 주소창에 `chrome://extensions/`를 입력합니다.
4. 우측 상단의 `개발자 모드`를 켭니다.
5. `압축해제된 확장 프로그램을 로드합니다` 버튼을 클릭합니다.
6. 복제 폴더 내의 `dist/` 폴더를 선택합니다.
7. 확장 프로그램을 활성화한 뒤 소프트웨어 마에스트로 홈페이지에 접속합니다.

> 코드를 수정하며 개발하려면 `npm run dev` 로 워치 모드 실행 — 변경 시 `dist/` 가 자동 재빌드되고, 확장은 `chrome://extensions` 의 새로고침 버튼으로 반영합니다.

※ 생각보다 적용이 쉬우니 사용을 추천드립니다!
  - 이후 확장프로그램 등록까지 고려중입니다.
