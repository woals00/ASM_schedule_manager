# Cloudflare Alarm Worker

브라우저가 꺼져 있어도 알림을 보내기 위한 Worker + D1 구성입니다.

## 역할

- 확장 프로그램이 신청한 멘토링 일정을 `/api/schedules/sync`로 전송
- Worker가 D1에 일정과 알림 채널 설정 저장
- Cron Trigger가 5분마다 실행되어 30분 전 / 1시간 전 디스코드 또는 텔레그램으로 알림 발송

## 준비

1. `cloudflare/wrangler.toml.example`을 `cloudflare/wrangler.toml`로 복사
2. D1 데이터베이스 생성
3. `database_id`를 실제 값으로 교체
4. 의존성 설치
5. 스키마 적용
6. API 토큰 등록

```bash
cd cloudflare
npm install
npx wrangler d1 create asm-schedule-db
npx wrangler d1 execute asm-schedule-db --file=./schema.sql
npx wrangler secret put API_TOKEN
npx wrangler deploy
```

## 확장 프로그램 설정값

확장 프로그램 대시보드의 `외부 알림 동기화` 섹션에 아래 값을 넣습니다.

- `Worker URL`: 배포된 Worker 주소
- `API 토큰`: `wrangler secret put API_TOKEN`으로 넣은 값
- `사용자 ID`: 본인 식별용 값
- `Discord Webhook URL` 또는 `Telegram Bot Token + Chat ID`
- 알림 시점: 30분 전, 1시간 전

## API 예시

```json
{
  "userId": "jaemin",
  "userLabel": "재민",
  "notifyOffsetsMinutes": [60, 30],
  "notificationTargets": {
    "discordWebhookUrl": "https://discord.com/api/webhooks/...",
    "telegramBotToken": "",
    "telegramChatId": ""
  },
  "schedules": [
    {
      "sourceEventId": "12345",
      "title": "백엔드 멘토링",
      "lectureType": "자유 멘토링",
      "mentorName": "홍길동",
      "startsAt": "2026-05-28T14:00:00+09:00",
      "endsAt": "2026-05-28T15:00:00+09:00",
      "location": "온라인",
      "status": "접수완료",
      "detailUrl": "https://www.swmaestro.ai/...",
      "cancelable": true
    }
  ]
}
```

## 주의

- 확장 프로그램이 Cloudflare와 동기화한 일정만 외부 알림 대상입니다.
- 일정이 바뀌면 접수 내역 페이지를 다시 열어 한 번 더 동기화해야 합니다.
- Discord와 Telegram 둘 다 입력하면 두 채널 모두 발송합니다.
