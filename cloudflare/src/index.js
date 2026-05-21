const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "asm-alarm-worker" });
    }

    if (request.method === "POST" && url.pathname === "/api/schedules/sync") {
      return handleScheduleSync(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/notifications/test") {
      return handleTestNotification(request, env);
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(controller, env, ctx) {
    await processPendingNotifications(env, controller.scheduledTime);
  }
};

async function handleScheduleSync(request, env) {
  const authHeader = request.headers.get("authorization") || "";
  const expectedToken = env.API_TOKEN;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const validationError = validateSyncPayload(payload);
  if (validationError) {
    return json({ error: validationError }, 400);
  }

  const nowIso = new Date().toISOString();
  const userId = payload.userId.trim();
  const userLabel = (payload.userLabel || "").trim();
  const discordWebhookUrl = (payload.notificationTargets.discordWebhookUrl || "").trim();
  const telegramBotToken = (payload.notificationTargets.telegramBotToken || "").trim();
  const telegramChatId = (payload.notificationTargets.telegramChatId || "").trim();
  const notifyOffsets = [...new Set(payload.notifyOffsetsMinutes)].sort((a, b) => b - a);

  await env.DB.prepare(`
    INSERT INTO users (
      id,
      display_name,
      discord_webhook_url,
      telegram_bot_token,
      telegram_chat_id,
      notify_offset_30_enabled,
      notify_offset_60_enabled,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      discord_webhook_url = excluded.discord_webhook_url,
      telegram_bot_token = excluded.telegram_bot_token,
      telegram_chat_id = excluded.telegram_chat_id,
      notify_offset_30_enabled = excluded.notify_offset_30_enabled,
      notify_offset_60_enabled = excluded.notify_offset_60_enabled,
      updated_at = excluded.updated_at
  `)
    .bind(
      userId,
      userLabel || userId,
      discordWebhookUrl,
      telegramBotToken,
      telegramChatId,
      notifyOffsets.includes(30) ? 1 : 0,
      notifyOffsets.includes(60) ? 1 : 0,
      nowIso
    )
    .run();

  const incomingIds = [];
  for (const schedule of payload.schedules) {
    incomingIds.push(schedule.sourceEventId);

    await env.DB.prepare(`
      INSERT INTO schedules (
        user_id,
        source_event_id,
        title,
        lecture_type,
        mentor_name,
        starts_at,
        ends_at,
        location,
        status,
        detail_url,
        cancelable,
        is_active,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(user_id, source_event_id) DO UPDATE SET
        title = excluded.title,
        lecture_type = excluded.lecture_type,
        mentor_name = excluded.mentor_name,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        location = excluded.location,
        status = excluded.status,
        detail_url = excluded.detail_url,
        cancelable = excluded.cancelable,
        is_active = 1,
        updated_at = excluded.updated_at
    `)
      .bind(
        userId,
        schedule.sourceEventId,
        schedule.title,
        schedule.lectureType || "",
        schedule.mentorName || "",
        schedule.startsAt,
        schedule.endsAt,
        schedule.location || "",
        schedule.status || "",
        schedule.detailUrl || "",
        schedule.cancelable ? 1 : 0,
        nowIso
      )
      .run();
  }

  const existingRows = await env.DB.prepare(`
    SELECT source_event_id
    FROM schedules
    WHERE user_id = ? AND is_active = 1
  `)
    .bind(userId)
    .all();

  const deactivateIds = (existingRows.results || [])
    .map((row) => row.source_event_id)
    .filter((sourceEventId) => !incomingIds.includes(sourceEventId));

  for (const sourceEventId of deactivateIds) {
    await env.DB.prepare(`
      UPDATE schedules
      SET is_active = 0, updated_at = ?
      WHERE user_id = ? AND source_event_id = ?
    `)
      .bind(nowIso, userId, sourceEventId)
      .run();
  }

  return json({
    ok: true,
    message: `일정 ${payload.schedules.length}건 동기화 완료`,
    syncedCount: payload.schedules.length,
    deactivatedCount: deactivateIds.length
  });
}

async function handleTestNotification(request, env) {
  const authHeader = request.headers.get("authorization") || "";
  const expectedToken = env.API_TOKEN;
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const userId = (payload?.userId || "").trim();
  if (!userId) {
    return json({ error: "userId is required" }, 400);
  }

  const candidateRows = await env.DB.prepare(`
    SELECT
      schedules.user_id,
      schedules.source_event_id,
      schedules.title,
      schedules.lecture_type,
      schedules.mentor_name,
      schedules.starts_at,
      schedules.ends_at,
      schedules.location,
      schedules.detail_url,
      users.display_name,
      users.discord_webhook_url,
      users.telegram_bot_token,
      users.telegram_chat_id
    FROM schedules
    JOIN users ON users.id = schedules.user_id
    WHERE schedules.user_id = ?
      AND schedules.is_active = 1
      AND schedules.starts_at >= ?
    ORDER BY schedules.starts_at ASC
  `)
    .bind(userId, new Date().toISOString())
    .all();

  const rows = candidateRows.results || [];
  if (rows.length === 0) {
    return json({ error: "동기화된 예정 일정이 없습니다." }, 404);
  }

  const tomorrowKstDate = getKstDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const targetRow = rows.find((row) => getKstDateString(new Date(row.starts_at)) === tomorrowKstDate) || rows[0];

  const delivered = await sendTestNotification(targetRow);
  if (!delivered) {
    return json({ error: "알림 채널 설정이 없습니다." }, 400);
  }

  return json({
    ok: true,
    message: `테스트 알림을 발송했습니다: ${targetRow.title}`,
    title: targetRow.title,
    startsAt: targetRow.starts_at
  });
}

function validateSyncPayload(payload) {
  if (!payload || typeof payload !== "object") return "Payload is required";
  if (!payload.userId || typeof payload.userId !== "string") return "userId is required";
  if (!Array.isArray(payload.schedules)) return "schedules must be an array";
  if (!Array.isArray(payload.notifyOffsetsMinutes) || payload.notifyOffsetsMinutes.length === 0) {
    return "notifyOffsetsMinutes must include at least one item";
  }
  if (!payload.notificationTargets || typeof payload.notificationTargets !== "object") {
    return "notificationTargets is required";
  }

  const hasDiscord = Boolean((payload.notificationTargets.discordWebhookUrl || "").trim());
  const hasTelegram = Boolean((payload.notificationTargets.telegramBotToken || "").trim()) &&
    Boolean((payload.notificationTargets.telegramChatId || "").trim());

  if (!hasDiscord && !hasTelegram) {
    return "At least one notification target is required";
  }

  for (const schedule of payload.schedules) {
    if (!schedule.sourceEventId || !schedule.title || !schedule.startsAt || !schedule.endsAt) {
      return "Each schedule needs sourceEventId, title, startsAt, and endsAt";
    }
  }

  return null;
}

async function processPendingNotifications(env, scheduledTime) {
  const now = new Date(scheduledTime || Date.now());
  const upperBound = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const lowerBound = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const rows = await env.DB.prepare(`
    SELECT
      schedules.user_id,
      schedules.source_event_id,
      schedules.title,
      schedules.lecture_type,
      schedules.mentor_name,
      schedules.starts_at,
      schedules.ends_at,
      schedules.location,
      schedules.detail_url,
      users.display_name,
      users.discord_webhook_url,
      users.telegram_bot_token,
      users.telegram_chat_id,
      users.notify_offset_30_enabled,
      users.notify_offset_60_enabled
    FROM schedules
    JOIN users ON users.id = schedules.user_id
    WHERE schedules.is_active = 1
      AND schedules.starts_at >= ?
      AND schedules.starts_at <= ?
  `)
    .bind(lowerBound, upperBound)
    .all();

  for (const row of rows.results || []) {
    const offsets = [];
    if (row.notify_offset_60_enabled) offsets.push(60);
    if (row.notify_offset_30_enabled) offsets.push(30);

    for (const offsetMinutes of offsets) {
      const triggerTime = new Date(new Date(row.starts_at).getTime() - offsetMinutes * 60 * 1000);
      const windowEnd = new Date(triggerTime.getTime() + 10 * 60 * 1000);

      if (now < triggerTime || now >= windowEnd) {
        continue;
      }

      await deliverNotification(env, row, offsetMinutes);
    }
  }
}

async function deliverNotification(env, scheduleRow, offsetMinutes) {
  const startDate = new Date(scheduleRow.starts_at);
  const endDate = new Date(scheduleRow.ends_at);
  const bodyText = buildNotificationText(scheduleRow, offsetMinutes, startDate, endDate);

  if (scheduleRow.discord_webhook_url) {
    const logged = await hasNotificationLog(env, scheduleRow.user_id, scheduleRow.source_event_id, offsetMinutes, "discord");
    if (!logged) {
      const response = await fetch(scheduleRow.discord_webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: bodyText
        })
      });

      if (response.ok) {
        await insertNotificationLog(env, scheduleRow.user_id, scheduleRow.source_event_id, offsetMinutes, "discord");
      }
    }
  }

  if (scheduleRow.telegram_bot_token && scheduleRow.telegram_chat_id) {
    const logged = await hasNotificationLog(env, scheduleRow.user_id, scheduleRow.source_event_id, offsetMinutes, "telegram");
    if (!logged) {
      const response = await fetch(`https://api.telegram.org/bot${scheduleRow.telegram_bot_token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: scheduleRow.telegram_chat_id,
          text: bodyText,
          disable_web_page_preview: true
        })
      });

      if (response.ok) {
        await insertNotificationLog(env, scheduleRow.user_id, scheduleRow.source_event_id, offsetMinutes, "telegram");
      }
    }
  }
}

async function sendTestNotification(scheduleRow) {
  const startDate = new Date(scheduleRow.starts_at);
  const endDate = new Date(scheduleRow.ends_at);
  const bodyText = buildNotificationText(scheduleRow, "테스트", startDate, endDate);
  let delivered = false;

  if (scheduleRow.discord_webhook_url) {
    const response = await fetch(scheduleRow.discord_webhook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: bodyText
      })
    });
    if (response.ok) delivered = true;
  }

  if (scheduleRow.telegram_bot_token && scheduleRow.telegram_chat_id) {
    const response = await fetch(`https://api.telegram.org/bot${scheduleRow.telegram_bot_token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: scheduleRow.telegram_chat_id,
        text: bodyText,
        disable_web_page_preview: true
      })
    });
    if (response.ok) delivered = true;
  }

  return delivered;
}

function buildNotificationText(scheduleRow, offsetMinutes, startDate, endDate) {
  const formatKst = (date) => {
    const formatter = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    return formatter.format(date);
  };

  const startText = formatKst(startDate);
  const endTimeText = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(endDate);

  return [
    offsetMinutes === "테스트"
      ? "🧪 ASM 일정 테스트 알림입니다."
      : `⏰ ${offsetMinutes}분 후 멘토링 일정이 시작됩니다.`,
    `이름: ${scheduleRow.display_name || scheduleRow.user_id}`,
    `제목: ${scheduleRow.title}`,
    `유형: ${scheduleRow.lecture_type || "멘토링"}`,
    `멘토: ${scheduleRow.mentor_name || "정보 없음"}`,
    `시간: ${startText} ~ ${endTimeText}`,
    `장소: ${scheduleRow.location || "정보 없음"}`,
    scheduleRow.detail_url ? `상세: ${scheduleRow.detail_url}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function getKstDateString(date) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

async function hasNotificationLog(env, userId, sourceEventId, offsetMinutes, channel) {
  const row = await env.DB.prepare(`
    SELECT 1
    FROM notification_logs
    WHERE user_id = ? AND source_event_id = ? AND offset_minutes = ? AND channel = ?
    LIMIT 1
  `)
    .bind(userId, sourceEventId, offsetMinutes, channel)
    .first();

  return Boolean(row);
}

async function insertNotificationLog(env, userId, sourceEventId, offsetMinutes, channel) {
  await env.DB.prepare(`
    INSERT INTO notification_logs (
      user_id,
      source_event_id,
      offset_minutes,
      channel,
      sent_at
    ) VALUES (?, ?, ?, ?, ?)
  `)
    .bind(userId, sourceEventId, offsetMinutes, channel, new Date().toISOString())
    .run();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}
