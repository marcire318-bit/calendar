
const WORKER_URL = "https://stream-calendar-api.marcire318.workers.dev";
const CHANNEL_ID = "UCqXxS-9x9Ha_UiH6hG4kh5Q";
const MANUAL_EVENTS_KEY = "streamCalendarManualEvents_v1";

const CACHE_KEY = "streamCalendarEvents_v2";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6時間

/* ------------------------------
   API呼び出し共通処理
------------------------------ */
async function fetchYouTube(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    throw new Error(
      `YouTube APIエラー: ${
        data?.error?.message || `HTTP ${response.status}`
      }`
    );
  }

  return data;
}

function apiUrl(resource, params) {
  const url = new URL(WORKER_URL);
  url.searchParams.set("resource", resource);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

/* ------------------------------
   配信予定・ライブ中
------------------------------ */
async function fetchUpcomingAndLive() {
  const searches = [
    { eventType: "upcoming" },
    { eventType: "live" }
  ];

  const results = await Promise.allSettled(
    searches.map(({ eventType }) =>
      fetchYouTube(
        apiUrl("search", {
          part: "id",
          channelId: CHANNEL_ID,
          eventType,
          type: "video",
          maxResults: "25"
        })
      )
    )
  );

  const ids = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      (result.value.items || []).forEach(item => {
        if (item?.id?.videoId) {
          ids.push(item.id.videoId);
        }
      });
    } else {
      errors.push(
        `${searches[index].eventType}: ${result.reason.message}`
      );
      console.error(result.reason);
    }
  });

  const uniqueIds = [...new Set(ids)];

  if (!uniqueIds.length) {
    if (errors.length) throw new Error(errors.join("\n"));
    return [];
  }

  const detailRes = await fetchYouTube(
    apiUrl("videos", {
      part: "snippet,liveStreamingDetails",
      id: uniqueIds.join(",")
    })
  );

  return detailRes.items || [];
}

/* ------------------------------
   アーカイブ
------------------------------ */
async function fetchArchives() {
  const channelRes = await fetchYouTube(
    apiUrl("channels", {
      part: "contentDetails",
      id: CHANNEL_ID
    })
  );

  const playlistId =
    channelRes.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!playlistId) return [];

  const playlistRes = await fetchYouTube(
    apiUrl("playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: "30"
    })
  );

  const ids = (playlistRes.items || [])
    .map(item => item?.contentDetails?.videoId)
    .filter(Boolean);

  if (!ids.length) return [];

  const detailRes = await fetchYouTube(
    apiUrl("videos", {
      part: "snippet,liveStreamingDetails",
      id: [...new Set(ids)].join(",")
    })
  );

  return (detailRes.items || []).map(video => {
    const live = video.liveStreamingDetails;
    const start =
      live?.actualEndTime ||
      live?.actualStartTime ||
      video.snippet?.publishedAt;

    return { ...video, archiveStart: start };
  });
}

/* ------------------------------
   データ取得とキャッシュ
   forceRefresh が true ならキャッシュを使わない
------------------------------ */
async function fetchAllEvents(forceRefresh = false) {
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);

      if (cached) {
        const parsed = JSON.parse(cached);

        if (
          parsed.savedAt &&
          Date.now() - parsed.savedAt < CACHE_TTL &&
          Array.isArray(parsed.events)
        ) {
          return parsed.events;
        }
      }
    } catch (error) {
      console.warn("保存済みデータを読み込めませんでした。", error);
    }
  }

  const [upcomingResult, archiveResult] =
    await Promise.allSettled([
      fetchUpcomingAndLive(),
      fetchArchives()
    ]);

  const upcoming =
    upcomingResult.status === "fulfilled"
      ? upcomingResult.value
      : [];

  const archives =
    archiveResult.status === "fulfilled"
      ? archiveResult.value
      : [];

  if (upcomingResult.status === "rejected") {
    console.error("配信予定・ライブ中の取得に失敗:", upcomingResult.reason);
  }

  if (archiveResult.status === "rejected") {
    console.error("アーカイブの取得に失敗:", archiveResult.reason);
  }

  const eventMap = new Map();

  [...upcoming, ...archives].forEach(event => {
    if (event?.id) {
      const existing = eventMap.get(event.id);
      eventMap.set(
        event.id,
        existing ? { ...existing, ...event } : event
      );
    }
  });

  const events = [...eventMap.values()];

  if (!events.length) {
    const messages = [];

    if (upcomingResult.status === "rejected") {
      messages.push(`配信予定の取得: ${upcomingResult.reason.message}`);
    }

    if (archiveResult.status === "rejected") {
      messages.push(`アーカイブの取得: ${archiveResult.reason.message}`);
    }

    throw new Error(
      messages.join("\n") || "配信データが見つかりませんでした。"
    );
  }

  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), events })
    );
  } catch (error) {
    console.warn("データを保存できませんでした。", error);
  }

  return events;
}

/* ------------------------------
   手動登録した配信
------------------------------ */
function loadManualEvents() {
  try {
    return JSON.parse(
      localStorage.getItem(MANUAL_EVENTS_KEY) || "[]"
    );
  } catch {
    return [];
  }
}

function saveManualEvents(events) {
  localStorage.setItem(
    MANUAL_EVENTS_KEY,
    JSON.stringify(events)
  );
}

function getVideoId(input) {
  try {
    const url = new URL(input.trim());

    if (url.hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (
      url.hostname === "www.youtube.com" ||
      url.hostname === "youtube.com" ||
      url.hostname === "m.youtube.com"
    ) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      const parts = url.pathname.split("/").filter(Boolean);

      if (["live", "shorts", "embed"].includes(parts[0])) {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function addManualEvent() {
  const input = prompt("YouTubeの配信URLを入力してね");
  if (!input) return;

  const videoId = getVideoId(input);

  if (!videoId) {
    alert("YouTubeの動画URLを確認してね。");
    return;
  }

  const existing = loadManualEvents();

  if (existing.some(event => event.id === videoId)) {
    alert("この配信はすでに登録されているよ。");
    return;
  }

  const date = prompt(
    "カレンダーに表示する日付を入力してね（例：2026-10-25）"
  );

  if (!date) return;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    alert("日付は YYYY-MM-DD 形式で入力してね。");
    return;
  }

  const parsedDate = new Date(`${date}T12:00:00`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getFullYear() !== Number(date.slice(0, 4)) ||
    parsedDate.getMonth() + 1 !== Number(date.slice(5, 7)) ||
    parsedDate.getDate() !== Number(date.slice(8, 10))
  ) {
    alert("有効な日付を入力してね。");
    return;
  }

  try {
    const data = await fetchYouTube(
      apiUrl("videos", {
        part: "snippet,liveStreamingDetails",
        id: videoId
      })
    );

    const video = data.items?.[0];
    console.log("手動登録動画の配信情報:", video); 

    if (!video) {
      alert("配信情報を取得できなかったよ。URLや公開設定を確認してね。");
      return;
    }

    const manualEvent = {
      ...video,
      manualDate: date,
      isManual: true
    };

    existing.push(manualEvent);
    saveManualEvents(existing);

    allEvents = [
      ...allEvents.filter(event => event.id !== videoId),
      manualEvent
    ];

    renderCalendar(allEvents);
    showEventDetails(manualEvent);

    alert("配信を登録したよ！");
  } catch (error) {
    console.error(error);
    alert(
      "配信情報を取得できなかったよ。\n" +
      "API設定や公開状態を確認してね。"
    );
  }
}

/* ------------------------------
   カレンダーの状態
------------------------------ */
let current = new Date();
let allEvents = [];
let isLoading = false;
let selectedEventId = null;

function getEventStart(event) {
  if (event.manualDate) {
    return `${event.manualDate}T12:00:00`;
  }

  const live = event.liveStreamingDetails;

  return (
    live?.scheduledStartTime ||
    live?.actualStartTime ||
    live?.actualEndTime ||
    event.archiveStart ||
    event.snippet?.publishedAt ||
    null
  );
}
function getThumbnail(event) {
  return (
    event.snippet?.thumbnails?.high?.url ||
    event.snippet?.thumbnails?.medium?.url ||
    event.snippet?.thumbnails?.default?.url ||
    ""
  );
}

function getEventType(event) {
  const live = event.liveStreamingDetails;

  if (live?.actualStartTime && !live?.actualEndTime) return "live";
  if (event.archiveStart || live?.actualEndTime) return "archive";

  return "upcoming";
}

function isLiveEvent(event) {
  const live = event.liveStreamingDetails;

  return Boolean(
    live?.actualStartTime &&
    !live?.actualEndTime
  );
}

/* ------------------------------
   詳細画面の表示用関数
------------------------------ */

// 詳細画面に表示する開始日時
function getDisplayStart(event) {
  const live = event.liveStreamingDetails || {};
  const type = getEventType(event);

  if (type === "upcoming") {
    return (
      live.scheduledStartTime ||
      event.manualDate ||
      event.snippet?.publishedAt ||
      null
    );
  }

  return (
    live.actualStartTime ||
    event.archiveStart ||
    event.snippet?.publishedAt ||
    event.manualDate ||
    null
  );
}

// 日時を日本語表記にする
function formatDateTime(value) {
  if (!value) return "未取得";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未取得";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo"
  }).format(date);
}

// ミリ秒を「○時間○分」に変換する
function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "未取得";
  }

  const totalMinutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}時間${minutes}分`;
  }

  return `${minutes}分`;
}

// 配信時間を取得する
function getDisplayDuration(event) {
  const live = event.liveStreamingDetails || {};
  const type = getEventType(event);

  if (type === "upcoming") return "未開始";

  if (!live.actualStartTime) return "未取得";

  const start = new Date(live.actualStartTime).getTime();
  const end = live.actualEndTime
    ? new Date(live.actualEndTime).getTime()
    : Date.now();

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start
  ) {
    return "未取得";
  }

  const duration = formatDuration(end - start);

  return type === "live"
    ? `${duration}（経過時間）`
    : duration;
}

// 配信状態を日本語で表示する
function getDisplayStatus(event) {
  const type = getEventType(event);

  if (type === "live") return "🔴 LIVE配信中";
  if (type === "archive") return "📼 アーカイブ";

  return "🗓️ 配信予定";
}

// 詳細項目を1行ずつ追加する
function appendDetailRow(container, label, value) {
  const row = document.createElement("p");
  row.className = "detail-row";

  const labelElement = document.createElement("strong");
  labelElement.className = "detail-label";
  labelElement.textContent = `${label}：`;

  const valueElement = document.createElement("span");
  valueElement.className = "detail-value";
  valueElement.textContent = value;

  row.append(labelElement, valueElement);
  container.appendChild(row);
}

function showStatus(message, isError = false) {
  const calendar = document.getElementById("calendar");
  if (!calendar) return;

  let status = document.getElementById("calendar-status");

  if (!status) {
    status = document.createElement("p");
    status.id = "calendar-status";
    calendar.prepend(status);
  }

  status.textContent = message;
  status.style.color = isError ? "#ffaaaa" : "";
}

/* ------------------------------
   カレンダー描画
------------------------------ */
function renderCalendar(events) {
  const calendar = document.getElementById("calendar");

  if (!calendar) {
    console.error('index.html に id="calendar" の要素がありません。');
    return;
  }

  const year = current.getFullYear();
  const month = current.getMonth();
  const last = new Date(year, month + 1, 0);
  const firstDay = new Date(year, month, 1).getDay();

  calendar.innerHTML = "";

  /* 月移動と手動更新のボタン */
  const header = document.createElement("div");
  header.className = "header";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "←";
  prev.setAttribute("aria-label", "前の月");

  const label = document.createElement("span");
  label.textContent = `${year}年 ${month + 1}月`;

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "→";
  next.setAttribute("aria-label", "次の月");

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "refresh-button";
  refresh.textContent = "↻ 更新";
  refresh.setAttribute("aria-label", "配信情報を手動更新");
  refresh.disabled = isLoading;
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "add-button";
  addButton.textContent = "＋ 追加";
  addButton.setAttribute("aria-label", "コラボ配信を追加");
  addButton.addEventListener("click", addManualEvent);

  prev.addEventListener("click", () => {
    current = new Date(year, month - 1, 1);
    renderCalendar(allEvents);
  });

  next.addEventListener("click", () => {
    current = new Date(year, month + 1, 1);
    renderCalendar(allEvents);
  });

  refresh.addEventListener("click", () => {
    init(true);
  });

  
const liveEvents = events.filter(isLiveEvent);

if (liveEvents.length > 0) {
  const liveButton = document.createElement("button");
  liveButton.type = "button";
  liveButton.className = "live-button";
  liveButton.textContent = `🔴 LIVE中 (${liveEvents.length})`;
  liveButton.addEventListener("click", () => {
    const live = events.filter(isLiveEvent);
    if (live.length > 0) {
      window.open(
        `https://www.youtube.com/watch?v=${encodeURIComponent(live[0].id)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }
  });

  header.append(prev, label, next, refresh, addButton, liveButton);
} else {
  header.append(prev, label, next, refresh, addButton);
}

calendar.appendChild(header);

  /* 日付グリッド */
  const grid = document.createElement("div");
  grid.className = "grid";
   
 // 1日の曜日に合わせて、先頭に空白セルを追加
  for (let i = 0; i < firstDay; i++) {
  const blank = document.createElement("div");
  blank.className = "cell empty";
  grid.appendChild(blank);
}

  for (let day = 1; day <= last.getDate(); day++) {
    const date = new Date(year, month, day);
    const cell = document.createElement("div");
    cell.className = "cell";

    if (date.toDateString() === new Date().toDateString()) {
      cell.classList.add("today");
    }

    const dayLabel = document.createElement("div");
    dayLabel.className = "day";
    dayLabel.textContent = day;
    cell.appendChild(dayLabel);

    const dayEvents = events
      .filter(event => {
        const start = getEventStart(event);
        return start &&
          new Date(start).toDateString() === date.toDateString();
      })
      .sort((a, b) =>
        new Date(getEventStart(a)) - new Date(getEventStart(b))
      );

    dayEvents.forEach(event => {
      const eventElement = document.createElement("div");
      eventElement.className = `event ${getEventType(event)}`;

      const thumbnail = getThumbnail(event);

      if (thumbnail) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "event-thumbnail-button";
        button.setAttribute(
          "aria-label",
          event.snippet?.title || "配信の詳細を表示"
        );

        const image = document.createElement("img");
        image.src = thumbnail;
        image.alt = event.snippet?.title || "配信サムネイル";
        image.loading = "lazy";

        button.appendChild(image);

      　// クリックしたときだけ詳細を表示
        button.addEventListener("click", () => {
          showEventDetails(event);
        });

        // スマホ：タップで詳細を表示
        button.addEventListener("click", () => {
          showEventDetails(event);
        });

        eventElement.appendChild(button);
      } else {
        const fallback = document.createElement("button");
        fallback.type = "button";
        fallback.className = "event-fallback-button";
        fallback.textContent = "サムネイルなし";
        fallback.addEventListener("click", () => {
          showEventDetails(event);
        });
        eventElement.appendChild(fallback);
      }

      eventElement.classList.add("event-item");
      cell.appendChild(eventElement);
    });

    grid.appendChild(cell);
    }

  calendar.appendChild(grid);

  // 月移動後も選択中の配信が存在すれば詳細を維持
  const selected = events.find(event => event.id === selectedEventId);

  if (selected) {
    showEventDetails(selected);
  }
}

/* ------------------------------
   詳細パネル
------------------------------ */

function showEventDetails(event) {
  const thumbnailContainer =
    document.getElementById("detail-thumbnail");

  const infoContainer =
    document.getElementById("detail-info");

  if (!thumbnailContainer || !infoContainer) return;

  selectedEventId = event.id;
  thumbnailContainer.innerHTML = "";
  infoContainer.innerHTML = "";

  // 1. サムネイル画像
  const thumb = getThumbnail(event);

  if (thumb) {
    const image = document.createElement("img");
    image.src = thumb;
    image.alt = event.snippet?.title || "配信サムネイル";
    image.loading = "lazy";
    thumbnailContainer.appendChild(image);
  }

  // 2. 配信タイトル
  const heading = document.createElement("h3");
  heading.textContent = event.snippet?.title || "タイトル不明";
  infoContainer.appendChild(heading);

  // 3. 開始日時
  const startDate = getDisplayStart(event);

  appendDetailRow(
    infoContainer,
    "開始日時",
    startDate ? formatDateTime(startDate) : "未取得"
  );

  // 4. 配信時間
  appendDetailRow(
    infoContainer,
    "配信時間",
    getDisplayDuration(event)
  );

  // 5. 配信状態
  appendDetailRow(
    infoContainer,
    "配信状態",
    getDisplayStatus(event)
  );

  // YouTubeへのリンク
  const link = document.createElement("a");
  link.href =
    `https://www.youtube.com/watch?v=${encodeURIComponent(event.id)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "YouTubeで見る";

  infoContainer.appendChild(link);
   
  // 手動登録した配信だけ、更新・削除ボタンを表示
  if (loadManualEvents().some(item => item.id === event.id)) {
    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = "refresh-button";
    updateButton.textContent = "↻ 情報を更新";

    updateButton.addEventListener("click", () => {
      updateManualEvent(event);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "🗑 削除";

    deleteButton.addEventListener("click", () => {
      deleteManualEvent(event);
    });

    infoContainer.append(updateButton, deleteButton);
  }
}

/* ------------------------------
   初期化・手動更新
------------------------------ */
async function init(forceRefresh = false) {
  if (isLoading) return;

  isLoading = true;
  showStatus(
    forceRefresh ? "最新の配信情報を取得中…" : "配信情報を読み込み中…"
  );

  // 更新中はボタンを押せないようにする
  const oldRefresh = document.querySelector(".refresh-button");
  if (oldRefresh) {
    oldRefresh.disabled = true;
    oldRefresh.textContent = "更新中…";
  }

  try {
    
allEvents = await fetchAllEvents(forceRefresh);


    // 保存済みの手動登録配信を取得
    const manualEvents = loadManualEvents();

    // 自動取得した配信をまとめる
    const eventMap = new Map(
      allEvents.map(event => [event.id, event])
    );

    // 手動登録した配信も最新情報を取得してから合流する
    const refreshedManualEvents = await Promise.all(
      manualEvents.map(async event => {
        try {
          const data = await fetchYouTube(
            apiUrl("videos", {
              part: "snippet,liveStreamingDetails",
              id: event.id
            })
          );

          const video = data.items?.[0];

          if (!video) {
            return event;
          }

          return {
            ...event,
            ...video,
            manualDate: event.manualDate,
            isManual: true
          };
        } catch (error) {
          console.warn(
            "手動登録した配信の更新に失敗:",
            event.id,
            error
          );

          // 更新できなかった配信は既存データを維持
          return event;
        }
      })
    );

    // 更新した手動登録データを保存
    saveManualEvents(refreshedManualEvents);

    // 手動登録した配信をカレンダーに合流
    refreshedManualEvents.forEach(event => {
      eventMap.set(event.id, event);
    });

    allEvents = [...eventMap.values()];

renderCalendar(allEvents);


    const status = document.getElementById("calendar-status");
    if (status) status.remove();

  } catch (error) {
    console.error(error);

    showStatus(
      `配信情報を取得できませんでした。\n${error.message}\n時間をおいて再読み込みしてください。`,
      true
    );

  } finally {
    isLoading = false;

    const refresh = document.querySelector(".refresh-button");
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = "↻ 更新";
    }
  }
}

init();
