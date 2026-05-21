const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

function buildCorsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request)
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "asm-alarm-worker" }, 200, request);
    }

    if (request.method === "POST" && url.pathname === "/api/schedules/sync") {
      return handleScheduleSync(request, env, { requireAuth: true, publicMode: false });
    }

    if (request.method === "POST" && url.pathname === "/api/notifications/test") {
      return handleTestNotification(request, env, { requireAuth: true });
    }

    if (request.method === "POST" && url.pathname === "/api/public/schedules/sync") {
      return handleScheduleSync(request, env, { requireAuth: false, publicMode: true });
    }

    if (request.method === "POST" && url.pathname === "/api/public/notifications/test") {
      return handleTestNotification(request, env, { requireAuth: false });
    }

    return json({ error: "Not found" }, 404, request);
  },

  async scheduled(controller, env, ctx) {
    await processPendingNotifications(env, controller.scheduledTime);
  }
};

function isAuthorizedRequest(request, env) {
  const authHeader = request.headers.get("authorization") || "";
  const expectedToken = env.API_TOKEN;
  return Boolean(expectedToken) && authHeader === `Bearer ${expectedToken}`;
}

async function handleScheduleSync(request, env, options = {}) {
  if (options.requireAuth && !isAuthorizedRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401, request);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, request);
  }

  const validationError = validateSyncPayload(payload, options);
  if (validationError) {
    return json({ error: validationError }, 400, request);
  }

  const nowIso = new Date().toISOString();
  const userId = payload.userId.trim();
  const userLabel = (payload.userLabel || "").trim();
  const discordWebhookUrl = (payload.notificationTargets.discordWebhookUrl || "").trim();
  const notifyEnabled = Boolean(payload.notifyEnabled);
  const desiredUser = {
    display_name: userLabel || userId,
    discord_webhook_url: discordWebhookUrl,
    notify_enabled: notifyEnabled ? 1 : 0
  };

  const existingUser = await env.DB.prepare(`
    SELECT
      display_name,
      discord_webhook_url,
      notify_enabled
    FROM users
    WHERE id = ?
    LIMIT 1
  `)
    .bind(userId)
    .first();

  if (
    !existingUser ||
    existingUser.display_name !== desiredUser.display_name ||
    (existingUser.discord_webhook_url || "") !== desiredUser.discord_webhook_url ||
    Number(existingUser.notify_enabled || 0) !== desiredUser.notify_enabled
  ) {
    await env.DB.prepare(`
      INSERT INTO users (
        id,
        display_name,
        discord_webhook_url,
        notify_enabled,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        discord_webhook_url = excluded.discord_webhook_url,
        notify_enabled = excluded.notify_enabled,
        updated_at = excluded.updated_at
    `)
      .bind(
        userId,
        desiredUser.display_name,
        desiredUser.discord_webhook_url,
        desiredUser.notify_enabled,
        nowIso
      )
      .run();
  }

  const existingRowsResult = await env.DB.prepare(`
    SELECT
      source_event_id,
      title,
      lecture_type,
      mentor_name,
      starts_at,
      ends_at,
      location,
      status,
      detail_url,
      cancelable
    FROM schedules
    WHERE user_id = ?
  `)
    .bind(userId)
    .all();

  const existingRows = existingRowsResult.results || [];
  const existingRowsById = new Map(existingRows.map((row) => [row.source_event_id, row]));

  const incomingIds = [];
  let insertedCount = 0;
  let updatedCount = 0;
  for (const schedule of payload.schedules) {
    incomingIds.push(schedule.sourceEventId);
    const existingRow = existingRowsById.get(schedule.sourceEventId);
    const isUnchanged = existingRow &&
      existingRow.title === schedule.title &&
      (existingRow.lecture_type || "") === (schedule.lectureType || "") &&
      (existingRow.mentor_name || "") === (schedule.mentorName || "") &&
      existingRow.starts_at === schedule.startsAt &&
      existingRow.ends_at === schedule.endsAt &&
      (existingRow.location || "") === (schedule.location || "") &&
      (existingRow.status || "") === (schedule.status || "") &&
      (existingRow.detail_url || "") === (schedule.detailUrl || "") &&
      Number(existingRow.cancelable || 0) === (schedule.cancelable ? 1 : 0);

    if (isUnchanged) {
      continue;
    }

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

    if (existingRow) {
      updatedCount += 1;
    } else {
      insertedCount += 1;
    }
  }

  const deleteIds = existingRows
    .map((row) => row.source_event_id)
    .filter((sourceEventId) => !incomingIds.includes(sourceEventId));

  for (const sourceEventId of deleteIds) {
    await env.DB.prepare(`
      DELETE FROM schedules
      WHERE user_id = ? AND source_event_id = ?
    `)
      .bind(userId, sourceEventId)
      .run();
  }

  return json({
    ok: true,
    message: `일정 ${payload.schedules.length}건 동기화 완료`,
    syncedCount: payload.schedules.length,
    insertedCount,
    updatedCount,
    deletedCount: deleteIds.length
  }, 200, request);
}

async function handleTestNotification(request, env, options = {}) {
  if (options.requireAuth && !isAuthorizedRequest(request, env)) {
    return json({ error: "Unauthorized" }, 401, request);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, request);
  }

  const userId = (payload?.userId || "").trim();
  if (!userId) {
    return json({ error: "userId is required" }, 400, request);
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
      users.discord_webhook_url
    FROM schedules
    JOIN users ON users.id = schedules.user_id
    WHERE schedules.user_id = ?
      AND schedules.is_active = 1
      AND datetime(schedules.starts_at) >= datetime(?)
    ORDER BY datetime(schedules.starts_at) ASC
  `)
    .bind(userId, new Date().toISOString())
    .all();

  const rows = candidateRows.results || [];
  if (rows.length === 0) {
    return json({ error: "동기화된 예정 일정이 없습니다." }, 404, request);
  }

  const tomorrowKstDate = getKstDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const targetRow = rows.find((row) => getKstDateString(new Date(row.starts_at)) === tomorrowKstDate) || rows[0];

  const delivered = await sendTestNotification(targetRow);
  if (!delivered) {
    return json({ error: "알림 채널 설정이 없습니다." }, 400, request);
  }

  return json({
    ok: true,
    message: `테스트 알림을 발송했습니다: ${targetRow.title}`,
    title: targetRow.title,
    startsAt: targetRow.starts_at
  }, 200, request);
}

function validateSyncPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") return "Payload is required";
  if (!payload.userId || typeof payload.userId !== "string") return "userId is required";
  if (!Array.isArray(payload.schedules)) return "schedules must be an array";
  if (payload.schedules.length > 200) return "schedules must not exceed 200 items";
  if (typeof payload.notifyEnabled !== "boolean") {
    return "notifyEnabled must be a boolean";
  }
  if (!payload.notificationTargets || typeof payload.notificationTargets !== "object") {
    return "notificationTargets is required";
  }

  const discordWebhookUrl = (payload.notificationTargets.discordWebhookUrl || "").trim();
  const hasDiscord = Boolean(discordWebhookUrl);
  if (options.publicMode && !/^https:\/\/discord\.com\/api\/webhooks\/[^/\s]+\/[^/\s]+$/.test(discordWebhookUrl)) {
    return "A valid Discord webhook URL is required";
  }

  if (options.publicMode && !hasDiscord) {
    return "A Discord webhook URL is required";
  }

  if (!options.publicMode && !hasDiscord) {
    return "A Discord webhook URL is required";
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
      users.notify_enabled
    FROM schedules
    JOIN users ON users.id = schedules.user_id
    WHERE schedules.is_active = 1
      AND datetime(schedules.starts_at) >= datetime(?)
      AND datetime(schedules.starts_at) <= datetime(?)
  `)
    .bind(lowerBound, upperBound)
    .all();

  for (const row of rows.results || []) {
    if (!row.notify_enabled) {
      continue;
    }

    const offsetMinutes = 60;
    const triggerTime = new Date(new Date(row.starts_at).getTime() - offsetMinutes * 60 * 1000);
    const windowEnd = new Date(triggerTime.getTime() + 10 * 60 * 1000);

    if (now < triggerTime || now >= windowEnd) {
      continue;
    }

    await deliverNotification(env, row, offsetMinutes);
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

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(request ? buildCorsHeaders(request) : {})
    }
  });
}
