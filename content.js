(function () {
  "use strict";

  if (!location.href.includes("mentoLec")) return;

  // ── 날짜 유틸 ─────────────────────────────────────────────────────────────

  const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

  function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function getMonthRange(offset = 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const base = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);

    return {
      start: base,
      end,
      today,
      year: base.getFullYear(),
      month: base.getMonth(),
    };
  }

  function normalizeText(text) {
    return (text || "")
      .toString()
      .trim()
      .normalize("NFC")
      .toLowerCase();
  }

  // ── 리스트 테이블 파싱 ────────────────────────────────────────────────────

  function parseTableRows(root) {
    const map = new Map();

    root.querySelectorAll("tbody tr").forEach((tr) => {
      const link = tr.querySelector('a[href*="mentoLec/view.do"]');
      if (!link) return;

      const snMatch = link.href.match(/qustnrSn=(\d+)/);
      if (!snMatch) return;

      const sn = snMatch[1];

      const allTds = tr.querySelectorAll("td");
      const pcTds = [...allTds].filter((td) => td.classList.contains("pc_only"));

      const dateTimeRaw = pcTds[2] ? pcTds[2].textContent : "";
      const dateMatch = dateTimeRaw.match(/(\d{4}-\d{2}-\d{2})/);
      const timeMatch = dateTimeRaw.match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/);

      const capRaw = pcTds[3] ? pcTds[3].textContent : "";
      const capMatch = capRaw.match(/(\d+)\s*\/\s*(\d+)/);

      const statusRaw = pcTds[5] ? pcTds[5].textContent.trim() : "";
      const author = pcTds[6] ? pcTds[6].textContent.trim() : "";

      const titleRaw = link.textContent.trim();
      const title = titleRaw.replace(/^\[(자유 멘토링|멘토 특강)\]\s*/, "");

      map.set(sn, {
        date: dateMatch ? dateMatch[1] : "",
        title,
        timeStart: timeMatch ? timeMatch[1] : "",
        timeEnd: timeMatch ? timeMatch[2] : "",
        current: capMatch ? capMatch[1] : "",
        total: capMatch ? capMatch[2] : "",
        isClosed: statusRaw.includes("마감"),
        author,
      });
    });

    return map;
  }

  // ── 전체 페이지 fetch + sessionStorage 캐시 ───────────────────────────────

  const CACHE_KEY = "asm_event_map_v4";
  const LOC_CACHE_KEY = "asm_location_v1";
  const CACHE_TTL = 1 * 60 * 1000;

  function loadCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;

      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) return null;

      return new Map(data);
    } catch {
      return null;
    }
  }

  function saveCache(map) {
    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ ts: Date.now(), data: [...map] })
      );
    } catch {}
  }

  async function fetchPageMap(pageIndex, baseUrl) {
    const url = `${baseUrl}&scdate=2026-01-01&ecdate=2026-12-31&edcDateOrder=&regDateOrder=&pageIndex=${pageIndex}`;
    const res = await fetch(url, { credentials: "include" });

    if (!res.ok) return new Map();

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    return parseTableRows(doc);
  }

  // ── 장소 캐시 ─────────────────────────────────────────────────────────────

  function loadLocCache() {
    try {
      const raw = sessionStorage.getItem(LOC_CACHE_KEY);
      if (!raw) return new Map();

      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > 30 * 60 * 1000) return new Map();

      return new Map(data);
    } catch {
      return new Map();
    }
  }

  function saveLocCache(map) {
    try {
      sessionStorage.setItem(
        LOC_CACHE_KEY,
        JSON.stringify({ ts: Date.now(), data: [...map] })
      );
    } catch {}
  }

  // ── 상세 페이지에서 장소 파싱 ─────────────────────────────────────────────

  function parseLocationFromDoc(doc) {
    for (const th of doc.querySelectorAll("th")) {
      if (th.textContent.trim() === "장소") {
        const td =
          th.nextElementSibling ||
          th.closest("tr")?.nextElementSibling?.querySelector("td");

        if (td) return td.textContent.trim();
      }
    }

    for (const dt of doc.querySelectorAll("dt")) {
      if (dt.textContent.trim() === "장소") {
        const dd = dt.nextElementSibling;
        if (dd) return dd.textContent.trim();
      }
    }

    for (const el of doc.querySelectorAll(".label, .tit, strong")) {
      if (el.textContent.trim() === "장소") {
        const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
        if (next) return next.textContent.trim();
      }
    }

    return null;
  }

  function classifyLocation(text) {
    if (!text) return null;

    const t = text.trim();
    if (!t) return null;

    if (t.includes("온라인") || /zoom|meet|teams|webex/i.test(t)) {
      return { type: "online", label: "온라인" };
    }

    return { type: "offline", label: "오프라인" };
  }

  async function fetchLocations(events) {
    const locCache = loadLocCache();
    const missing = events.filter((ev) => ev.sn && !locCache.has(ev.sn));

    if (missing.length === 0) return locCache;

    const origin = location.origin;

    const results = await Promise.allSettled(
      missing.map(async (ev) => {
        const url = `${origin}/busan/sw/mypage/mentoLec/view.do?qustnrSn=${ev.sn}&menuNo=200046`;
        const res = await fetch(url, { credentials: "include" });

        if (!res.ok) return { sn: ev.sn, loc: null };

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        return { sn: ev.sn, loc: parseLocationFromDoc(doc) };
      })
    );

    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value.sn) {
        locCache.set(r.value.sn, r.value.loc ?? "");
      }
    });

    saveLocCache(locCache);

    return locCache;
  }

  function getBaseUrl() {
    const u = new URL(location.href);
    return `${u.origin}${u.pathname}?menuNo=${u.searchParams.get("menuNo") || "200046"}`;
  }

  function getTotalPages() {
    const lastLink = document.querySelector(
      '.paginationSet a[title="마지막 목록"], .paginationSet .i.last a'
    );

    if (lastLink) {
      const m = lastLink.href.match(/pageIndex=(\d+)/);
      if (m) return parseInt(m[1], 10);
    }

    const pageLinks = document.querySelectorAll(".paginationSet li a");
    let max = 1;

    pageLinks.forEach((a) => {
      const m = a.href.match(/pageIndex=(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });

    return max;
  }

  async function buildCompleteEventMap(onProgress) {
    const cached = loadCache();
    if (cached) return cached;

    const merged = parseTableRows(document);
    const totalPages = getTotalPages();
    const baseUrl = getBaseUrl();

    if (totalPages <= 1) {
      saveCache(merged);
      return merged;
    }

    const pageNums = [];
    for (let i = 2; i <= totalPages; i++) pageNums.push(i);

    const results = await Promise.allSettled(
      pageNums.map((n) => fetchPageMap(n, baseUrl))
    );

    results.forEach((r) => {
      if (r.status === "fulfilled") {
        r.value.forEach((v, k) => {
          if (!merged.has(k)) merged.set(k, v);
        });
      }
    });

    saveCache(merged);

    if (onProgress) onProgress(merged);

    return merged;
  }

  // ── 이벤트 수집 ───────────────────────────────────────────────────────────

  function collectEvents(eventMap) {
    const events = [];
    const seen = new Set();

    document
      .querySelectorAll(".mypageCalendar .datepicker-days tbody td[data-date] ul li.category")
      .forEach((li) => {
        const td = li.closest("td[data-date]");
        const date = td ? td.getAttribute("data-date") : null;

        if (!date) return;

        const anchor = li.querySelector("a[title]");
        if (!anchor) return;

        const title = anchor.getAttribute("title") || "";
        const category = [...anchor.classList].find((c) => c.startsWith("MRC")) || "";
        const popLink = li.querySelector(".calendarPop a.link");
        const snMatch = popLink ? popLink.href.match(/qustnrSn=(\d+)/) : null;
        const sn = snMatch ? snMatch[1] : null;
        const url = popLink ? popLink.href : "#";

        if (sn && seen.has(sn)) return;
        if (sn) seen.add(sn);

        const info = (sn && eventMap.get(sn)) || {};

        events.push({
          sn,
          date: info.date || date,
          title,
          category,
          categoryNm: category === "MRC010" ? "자유 멘토링" : "멘토 특강",
          url,
          isClosed: info.isClosed ?? false,
          current: info.current || "",
          total: info.total || "",
          author: info.author || "",
          timeStart: info.timeStart || "",
          timeEnd: info.timeEnd || "",
        });
      });

    eventMap.forEach((info, sn) => {
      if (seen.has(sn) || !info.date) return;

      const link = document.querySelector(`a[href*="qustnrSn=${sn}"][href*="mentoLec/view"]`);
      const titleFromDom = link
        ? link.textContent.trim().replace(/^\[(자유 멘토링|멘토 특강)\]\s*/, "")
        : "";

      const title = info.title || titleFromDom || `(번호 ${sn})`;
      const titleRaw = link ? link.textContent.trim() : info.title || "";
      const category = titleRaw.startsWith("[자유 멘토링]") ? "MRC010" : "MRC020";
      const url = link
        ? link.href
        : `${location.origin}/busan/sw/mypage/mentoLec/view.do?qustnrSn=${sn}&menuNo=200046`;

      events.push({
        sn,
        date: info.date,
        title,
        category,
        categoryNm: category === "MRC010" ? "자유 멘토링" : "멘토 특강",
        url,
        isClosed: info.isClosed,
        current: info.current,
        total: info.total,
        author: info.author,
        timeStart: info.timeStart,
        timeEnd: info.timeEnd,
      });
    });

    return events;
  }

  // ── 검색 필터 ─────────────────────────────────────────────────────────────

  function filterEventsBySearch(events, searchType, searchKeyword) {
    const keyword = normalizeText(searchKeyword);
    if (!keyword) return events;

    return events.filter((ev) => {
      const target =
        searchType === "title"
          ? normalizeText(ev.title)
          : normalizeText(ev.author);

      return target.includes(keyword);
    });
  }

  // ── 이벤트 정렬 유틸 ──────────────────────────────────────────────────────

  function getEventStatusGroup(ev, todayStr) {
    const isPast = ev.date < todayStr;
    const isClosed = ev.isClosed;

    return isPast || isClosed ? 1 : 0;
  }

  function timeToMinutes(time) {
    if (!time) return 24 * 60 + 999;

    const [h, m] = time.split(":").map(Number);

    if (Number.isNaN(h) || Number.isNaN(m)) {
      return 24 * 60 + 999;
    }

    return h * 60 + m;
  }

  function getComparableAuthor(author) {
    return (author || "")
      .replace(/\s*멘토\s*$/g, "")
      .trim()
      .normalize("NFC");
  }

  function getComparableTitle(title) {
    return (title || "")
      .replace(/^\s*\[(온라인|오프라인)\]\s*/g, "")
      .replace(/^\s*\((온라인|오프라인)\)\s*/g, "")
      .replace(/^\s*\[(자유 멘토링|멘토 특강)\]\s*/g, "")
      .trim()
      .normalize("NFC");
  }

  function compareKoreanText(aText, bText) {
    return aText.localeCompare(bText, "ko-KR", {
      usage: "sort",
      sensitivity: "variant",
      numeric: true,
      ignorePunctuation: true,
    });
  }

  function sortEventsByStatusTimeAuthor(a, b, todayStr) {
    const groupA = getEventStatusGroup(a, todayStr);
    const groupB = getEventStatusGroup(b, todayStr);

    if (groupA !== groupB) return groupA - groupB;

    const timeA = timeToMinutes(a.timeStart);
    const timeB = timeToMinutes(b.timeStart);

    if (timeA !== timeB) return timeA - timeB;

    const authorA = getComparableAuthor(a.author);
    const authorB = getComparableAuthor(b.author);

    const authorCompare = compareKoreanText(authorA, authorB);
    if (authorCompare !== 0) return authorCompare;

    const titleA = getComparableTitle(a.title);
    const titleB = getComparableTitle(b.title);

    const titleCompare = compareKoreanText(titleA, titleB);
    if (titleCompare !== 0) return titleCompare;

    return String(a.sn || "").localeCompare(String(b.sn || ""), "ko-KR", {
      numeric: true,
    });
  }

  // ── 이벤트 카드 생성 ──────────────────────────────────────────────────────

  function makeCard(ev, todayStr) {
    const isPast = ev.date < todayStr;
    const isGray = isPast || ev.isClosed;

    const card = document.createElement("div");
    card.className = `asm-event-card ${isGray ? "asm-card-gray" : "asm-card-open asm-cat-" + ev.category}`;
    card.setAttribute("role", "link");
    card.setAttribute("tabindex", "0");
    card.style.cursor = "pointer";

    card.addEventListener("click", () => {
      if (ev.url && ev.url !== "#") {
        window.open(ev.url, "_blank");
      }
    });

    card.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && ev.url && ev.url !== "#") {
        e.preventDefault();
        window.open(ev.url, "_blank");
      }
    });

    const badges = document.createElement("div");
    badges.className = "asm-card-badges";

    const catBadge = document.createElement("span");
    catBadge.className = `asm-badge asm-cat-badge asm-cat-${ev.category}`;
    catBadge.textContent = ev.categoryNm;
    badges.appendChild(catBadge);

    const locInfo = ev.location ? classifyLocation(ev.location) : null;

    if (locInfo) {
      badges.appendChild(
        mkBadge(locInfo.label, locInfo.type === "online" ? "asm-online" : "asm-offline")
      );
    } else if (ev.title.includes("[온라인]") || ev.title.includes("(온라인)")) {
      badges.appendChild(mkBadge("온라인", "asm-online"));
    } else if (ev.title.includes("[오프라인]") || ev.title.includes("(오프라인)")) {
      badges.appendChild(mkBadge("오프라인", "asm-offline"));
    }

    const statusLabel = isPast ? "진행완료" : ev.isClosed ? "마감" : "접수중";
    const statusCls = isPast ? "asm-done" : ev.isClosed ? "asm-closed" : "asm-open-badge";

    badges.appendChild(mkBadge(statusLabel, statusCls));
    card.appendChild(badges);

    const titleEl = document.createElement("div");
    titleEl.className = "asm-card-title";
    titleEl.textContent = ev.title;
    card.appendChild(titleEl);

    const footer = document.createElement("div");
    footer.className = "asm-card-footer";

    if (ev.author) {
      const author = document.createElement("div");
      author.className = "asm-card-author";
      author.textContent = ev.author + " 멘토";
      footer.appendChild(author);
    }

    if (ev.timeStart) {
      const time = document.createElement("div");
      time.className = "asm-card-time";
      time.textContent = `${ev.timeStart} ~ ${ev.timeEnd}`;
      footer.appendChild(time);
    }

    const bottom = document.createElement("div");
    bottom.className = "asm-card-footer-bottom";

    if (ev.current !== "" && ev.total !== "") {
      const cap = document.createElement("span");
      cap.className = "asm-cap";
      cap.textContent = `${ev.current}/${ev.total}명`;
      bottom.appendChild(cap);
    }

    footer.appendChild(bottom);
    card.appendChild(footer);

    return card;
  }

  function mkBadge(text, cls) {
    const el = document.createElement("span");
    el.className = `asm-badge ${cls}`;
    el.textContent = text;
    return el;
  }

  // ── 날짜 클릭 이벤트 패널 렌더 ───────────────────────────────────────────

  function renderEventPanel(container, dayEvents, dateStr, todayStr, isLoading) {
    container.innerHTML = "";

    const d = new Date(dateStr + "T00:00:00");

    const headerEl = document.createElement("div");
    headerEl.className = "asm-event-panel-header";

    const dateLabel = document.createElement("span");
    dateLabel.className = "asm-event-panel-date";
    dateLabel.textContent = `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}(${DAY_KO[d.getDay()]})`;

    const cntLabel = document.createElement("span");
    cntLabel.className = "asm-event-panel-cnt";
    cntLabel.textContent = `${dayEvents.length}건`;

    headerEl.appendChild(dateLabel);
    headerEl.appendChild(cntLabel);
    container.appendChild(headerEl);

    if (dayEvents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "asm-event-panel-placeholder";
      empty.innerHTML = "<span>해당 날짜에 표시할 일정이 없습니다</span>";
      container.appendChild(empty);
      return;
    }

    const cards = document.createElement("div");
    cards.className = "asm-day-cards";

    [...dayEvents]
      .sort((a, b) => sortEventsByStatusTimeAuthor(a, b, todayStr))
      .forEach((ev) => cards.appendChild(makeCard(ev, todayStr)));

    container.appendChild(cards);
  }

  // ── 검색 UI ───────────────────────────────────────────────────────────────

  function createSearchRow(searchDraft, onSearchChange, onSearchSubmit, onSearchReset) {
    const row = document.createElement("div");
    row.className = "asm-search-row";

    const select = document.createElement("select");
    select.className = "asm-search-select";
    select.value = searchDraft.type;

    const titleOption = document.createElement("option");
    titleOption.value = "title";
    titleOption.textContent = "제목";

    const authorOption = document.createElement("option");
    authorOption.value = "author";
    authorOption.textContent = "작성자";

    select.appendChild(titleOption);
    select.appendChild(authorOption);

    const input = document.createElement("input");
    input.className = "asm-search-input";
    input.type = "text";
    input.placeholder = "검색어를 입력해주세요.";
    input.value = searchDraft.keyword;

    const searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "asm-search-btn";
    searchBtn.textContent = "검색";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "asm-search-reset";
    resetBtn.textContent = "초기화";

    select.addEventListener("change", () => {
      onSearchChange(select.value, input.value);
    });

    input.addEventListener("input", () => {
      onSearchChange(select.value, input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSearchSubmit(select.value, input.value);
      }
    });

    searchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onSearchSubmit(select.value, input.value);
    });

    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onSearchReset();
    });

    const searchBox = document.createElement("div");
    searchBox.className = "asm-search-box";
    searchBox.appendChild(input);
    searchBox.appendChild(searchBtn);

    row.appendChild(select);
    row.appendChild(searchBox);
    row.appendChild(resetBtn);

    return row;
  }

  // ── 캘린더 패널 빌드 ─────────────────────────────────────────────────────

  function buildPanel(
    events,
    isLoading,
    offset = 0,
    onNavigate = null,
    searchDraft = { type: "title", keyword: "" },
    onSearchChange = null,
    onSearchSubmit = null,
    onSearchReset = null,
    isCollapsed = false,
    onToggleCollapsed = null
  ) {
    const { start, end, today, year, month } = getMonthRange(offset);
    const todayStr = toDateStr(today);
    const defaultSelectedDate = offset === 0 ? todayStr : toDateStr(start);

    const byDate = new Map();

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      byDate.set(toDateStr(new Date(d)), []);
    }

    events.forEach((ev) => {
      if (byDate.has(ev.date)) byDate.get(ev.date).push(ev);
    });

    const panel = document.createElement("div");
    panel.id = "asm-2week-panel";

    // 헤더
    const header = document.createElement("div");
    header.className = "asm-panel-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "asm-panel-title-wrap";
    titleWrap.innerHTML = `<span class="asm-panel-ico">📅</span><span class="asm-panel-title">${year}년 ${month + 1}월</span>`;

    const loadingEl = document.createElement("span");
    loadingEl.className = "asm-panel-loading";
    loadingEl.id = "asm-panel-loading";
    loadingEl.textContent = isLoading ? "데이터 불러오는 중…" : "";

    titleWrap.appendChild(loadingEl);
    header.appendChild(titleWrap);

    // 네비게이션: 이전달 / 오늘 / 다음달 항상 표시해서 위치 고정
    const navWrap = document.createElement("div");
    navWrap.className = "asm-panel-nav";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "asm-panel-nav-btn";
    prevBtn.textContent = "‹ 이전달";
    prevBtn.title = "이전 달";
    prevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onNavigate && onNavigate(offset - 1);
    });
    navWrap.appendChild(prevBtn);

    const todayBtn = document.createElement("button");
    todayBtn.type = "button";
    todayBtn.className =
      offset === 0
        ? "asm-panel-nav-btn asm-nav-today asm-nav-today-current"
        : "asm-panel-nav-btn asm-nav-today";
    todayBtn.textContent = "오늘";
    todayBtn.title = "오늘이 포함된 달로 이동";
    todayBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onNavigate && onNavigate(0);
    });
    navWrap.appendChild(todayBtn);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "asm-panel-nav-btn";
    nextBtn.textContent = "다음달 ›";
    nextBtn.title = "다음 달";
    nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onNavigate && onNavigate(offset + 1);
    });
    navWrap.appendChild(nextBtn);

    header.appendChild(navWrap);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "asm-panel-toggle";
    toggleBtn.textContent = isCollapsed ? "펼치기" : "접기";

    header.appendChild(toggleBtn);
    panel.appendChild(header);

    const body = document.createElement("div");
    body.className = "asm-panel-body";
    body.style.display = isCollapsed ? "none" : "";

    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onToggleCollapsed && onToggleCollapsed();
    });

    // 요일 헤더
    const wdRow = document.createElement("div");
    wdRow.className = "asm-cal-weekdays";

    ["일", "월", "화", "수", "목", "금", "토"].forEach((wd, i) => {
      const cell = document.createElement("div");
      cell.className = `asm-cal-wd${i === 0 || i === 6 ? " asm-wd-weekend" : ""}`;
      cell.textContent = wd;
      wdRow.appendChild(cell);
    });

    // 날짜 그리드
    const grid = document.createElement("div");
    grid.className = "asm-cal-grid";

    const eventPanel = document.createElement("div");
    eventPanel.className = "asm-event-panel";

    function showPlaceholder() {
      if (isLoading) {
        eventPanel.innerHTML = '<div class="asm-event-panel-placeholder"><span class="asm-loading-spinner"></span><span>데이터 불러오는 중…</span></div>';
      } else {
        eventPanel.innerHTML = '<div class="asm-event-panel-placeholder"><span>날짜를 선택하면<br>일정이 표시됩니다</span></div>';
      }
    }

    function selectDate(dateStr) {
      const cell = grid.querySelector(`[data-date="${dateStr}"]`);
      const dayEvents = byDate.get(dateStr) || [];

      grid.querySelectorAll(".asm-cal-day.asm-cal-selected").forEach((c) =>
        c.classList.remove("asm-cal-selected")
      );

      selectedDate = dateStr;

      if (cell) {
        cell.classList.add("asm-cal-selected");
      }

      const sortedDayEvents = [...dayEvents].sort((a, b) =>
        sortEventsByStatusTimeAuthor(a, b, todayStr)
      );

      renderEventPanel(eventPanel, sortedDayEvents, dateStr, todayStr);
    }

    // 월 첫째 날 요일 전 빈 셀
    for (let i = 0; i < start.getDay(); i++) {
      const empty = document.createElement("div");
      empty.className = "asm-cal-day asm-cal-empty";
      grid.appendChild(empty);
    }

    byDate.forEach((dayEvents, dateStr) => {
      const d = new Date(dateStr + "T00:00:00");
      const isToday = dateStr === todayStr;
      const isPast = dateStr < todayStr;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const hasEvents = dayEvents.length > 0;

      const sortedDayEvents = [...dayEvents].sort((a, b) =>
        sortEventsByStatusTimeAuthor(a, b, todayStr)
      );

      const cell = document.createElement("div");

      cell.className = [
        "asm-cal-day",
        isToday ? "asm-cal-today" : "",
        isPast ? "asm-cal-past" : "",
        isWeekend ? "asm-cal-weekend" : "",
        hasEvents ? "asm-cal-has-events" : "",
      ]
        .filter(Boolean)
        .join(" ");

      cell.dataset.date = dateStr;

      const numEl = document.createElement("div");
      numEl.className = "asm-cal-daynum";
      numEl.textContent = d.getDate();
      cell.appendChild(numEl);

      if (hasEvents) {
        const cntEl = document.createElement("div");
        cntEl.className = "asm-cal-cnt";
        cntEl.textContent = `${sortedDayEvents.length}건`;
        cell.appendChild(cntEl);

        const dotsEl = document.createElement("div");
        dotsEl.className = "asm-cal-dots";

        const maxDots = Math.min(sortedDayEvents.length, 5);

        sortedDayEvents.slice(0, maxDots).forEach((ev) => {
          const dot = document.createElement("span");
          const pastEv = ev.date < todayStr;

          dot.className = `asm-dot ${
            pastEv || ev.isClosed ? "asm-dot-gray" : "asm-dot-" + ev.category
          }`;

          dotsEl.appendChild(dot);
        });

        if (sortedDayEvents.length > maxDots) {
          const more = document.createElement("span");
          more.className = "asm-dot-more";
          more.textContent = `+${sortedDayEvents.length - maxDots}`;
          dotsEl.appendChild(more);
        }

        cell.appendChild(dotsEl);
      }

      cell.addEventListener("click", () => {
        selectDate(dateStr);
      });

      grid.appendChild(cell);
    });

    const calSection = document.createElement("div");
    calSection.className = "asm-cal-section";
    calSection.appendChild(wdRow);
    calSection.appendChild(grid);

    const searchRow = createSearchRow(
      searchDraft,
      onSearchChange || (() => {}),
      onSearchSubmit || (() => {}),
      onSearchReset || (() => {})
    );

    // 핵심 수정: 검색창을 달력 바로 위에 배치
    const calArea = document.createElement("div");
    calArea.className = "asm-cal-area";
    calArea.appendChild(searchRow);
    calArea.appendChild(calSection);

    body.appendChild(calArea);
    body.appendChild(eventPanel);
    panel.appendChild(body);

    setTimeout(() => {
      selectDate(defaultSelectedDate);
    }, 0);

    return {
      panel,
      grid,
      eventPanel,
      byDate,
      selectedDate: () => selectedDate,
    };
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────

  async function init() {
    const calWrap = document.querySelector(".mypageCalendar.wrap");
    if (!calWrap) return;

    let currentOffset = 0;
    let allEvents = [];

    let appliedSearchType = "title";
    let appliedSearchKeyword = "";

    let draftSearchType = "title";
    let draftSearchKeyword = "";

    let isPanelCollapsed = false;

    function getFilteredEvents() {
      const { start, end } = getMonthRange(currentOffset);
      const s = toDateStr(start);
      const e = toDateStr(end);

      const monthEvents = allEvents
        .map((ev) => ({ ...ev }))
        .filter((ev) => ev.date >= s && ev.date <= e);

      return filterEventsBySearch(monthEvents, appliedSearchType, appliedSearchKeyword);
    }

    function withLocations(events) {
      const cache = loadLocCache();

      return events.map((ev) => {
        if (ev.sn && cache.has(ev.sn)) {
          return { ...ev, location: cache.get(ev.sn) || null };
        }

        return ev;
      });
    }

    function renderPanel(events, loading, focusSearch = false) {
      const existing = document.getElementById("asm-2week-panel");

      const searchDraft = {
        type: draftSearchType,
        keyword: draftSearchKeyword,
      };

      const { panel } = buildPanel(
        events,
        loading,
        currentOffset,
        navigate,
        searchDraft,
        handleSearchDraftChange,
        handleSearchSubmit,
        handleSearchReset,
        isPanelCollapsed,
        handleToggleCollapsed
      );

      if (existing) {
        existing.parentNode.replaceChild(panel, existing);
      } else {
        const bbsTop = document.querySelector(".bbs-top.bg");

        if (bbsTop) {
          bbsTop.parentNode.insertBefore(panel, bbsTop);
        } else {
          calWrap.parentNode.insertBefore(panel, calWrap);
        }
      }

      if (focusSearch) {
        const input = panel.querySelector(".asm-search-input");
        if (input) {
          input.focus();
          const len = input.value.length;
          input.setSelectionRange(len, len);
        }
      }
    }

    function handleSearchDraftChange(nextType, nextKeyword) {
      draftSearchType = nextType;
      draftSearchKeyword = nextKeyword;
    }

    function handleSearchSubmit(nextType, nextKeyword) {
      draftSearchType = nextType;
      draftSearchKeyword = nextKeyword;
      appliedSearchType = nextType;
      appliedSearchKeyword = nextKeyword;

      renderPanel(withLocations(getFilteredEvents()), false, true);
    }

    function handleSearchReset() {
      draftSearchType = "title";
      draftSearchKeyword = "";
      appliedSearchType = "title";
      appliedSearchKeyword = "";

      renderPanel(withLocations(getFilteredEvents()), false, true);
    }

    function handleToggleCollapsed() {
      isPanelCollapsed = !isPanelCollapsed;
      renderPanel(withLocations(getFilteredEvents()), false);
    }

    async function navigate(newOffset) {
      currentOffset = newOffset;

      renderPanel(withLocations(getFilteredEvents()), false);

      await fetchLocations(getFilteredEvents());

      renderPanel(withLocations(getFilteredEvents()), false);
    }

    // ① 현재 페이지 데이터로 즉시 렌더
    const initialMap = parseTableRows(document);
    allEvents = collectEvents(initialMap);
    renderPanel(withLocations(getFilteredEvents()), !loadCache());

    // ② 전체 페이지 fetch → 멘토/인원/상태 완성
    const completeMap = await buildCompleteEventMap();
    allEvents = collectEvents(completeMap);
    renderPanel(withLocations(getFilteredEvents()), true);

    // ③ 상세 페이지 fetch → 장소 정보 반영
    await fetchLocations(getFilteredEvents());
    renderPanel(withLocations(getFilteredEvents()), false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();