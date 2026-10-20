const API_KEY = "AIzaSyDGhMHU9HZwv05wMjJfOJBecDtIg58SiW0”;
const CHANNEL_ID = "UCqXxS-9x9Ha_UiH6hG4kh5Q";

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
  const url = new URL(
    `https://www.googleapis.com/youtube/v3/${resource}`
  );

  Object.entries({ ...params, key: API_KEY }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

/* ------------------------------
   配信予定・ライブ中
   Search APIは最大2回使用
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
    if (errors.length) {
      throw new Error(errors.join("\n"));
    }
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
   Search APIを使わずアップロード一覧から取得
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

  if (!playlistId) {
    return [];
  }

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

  if (!ids.length) {
    return [];
  }

  const detailRes = await fetchYouTube(
    apiUrl("videos", {
      part: "snippet,liveStreamingDetails",
      id: [...new Set(ids)].join(",")
    })
  );

  return (detailRes.items || []).map(video => {
    const live = video.liveStreamingDetails;

    const start =
      (live && (live.actualEndTime || live.actualStartTime)) ||
      video.snippet?.publishedAt;

    return {
      ...video,
      archiveStart: start
    };
  });
}

/* ------------------------------
   データ取得とキャッシュ
   6時間は保存済みデータを使用
------------------------------ */
async function fetchAllEvents() {
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
    console.error(
      "配信予定・ライブ中の取得に失敗:",
      upcomingResult.reason
    );
  }

  if (archiveResult.status === "rejected") {
    console.error(
      "アーカイブの取得に失敗:",
      archiveResult.reason
    );
  }

  // 同じ動画が重複しないようにまとめる
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
      messages.push(
        `配信予定の取得: ${upcomingResult.reason.message}`
      );
    }

    if (archiveResult.status === "rejected") {
      messages.push(
        `アーカイブの取得: ${archiveResult.reason.message}`
      );
    }

    throw new Error(
      messages.join("\n") || "配信データが見つかりませんでした。"
    );
  }

  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        events
      })
    );
  } catch (error) {
    console.warn("データを保存できませんでした。", error);
  }

  return events;
}

/* ------------------------------
   カレンダー描画
------------------------------ */
let current = new Date();
let allEvents = [];
let isLoading = false;

function getEventStart(event) {
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
  status.style.color = isError ? "#b42318" : "";
}

function renderCalendar(events) {
  const calendar = document.getElementById("calendar");

  if (!calendar) {
    console.error('index.html に id="calendar" の要素がありません。');
    return;
  }

  const year = current.getFullYear();
  const month = current.getMonth();
  const last = new Date(year, month + 1, 0);

  calendar.innerHTML = "";

  /* 月移動ボタン */
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

  prev.addEventListener("click", () => {
    current = new Date(
      current.getFullYear(),
      current.getMonth() - 1,
      1
    );
    renderCalendar(allEvents);
  });

  next.addEventListener("click", () => {
    current = new Date(
      current.getFullYear(),
      current.getMonth() + 1,
      1
    );
    renderCalendar(allEvents);
  });

  header.append(prev, label, next);
  calendar.appendChild(header);

  /* 日付グリッド */
  const grid = document.createElement("div");
  grid.className = "grid";

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

    const dayEvents = events.filter(event => {
      const start = getEventStart(event);

      return (
        start &&
        new Date(start).toDateString() === date.toDateString()
      );
    });

    dayEvents.forEach(event => {
      const live = event.liveStreamingDetails;

      const isLive = Boolean(
        live?.actualStartTime && !live?.actualEndTime
      );

      const isArchive = Boolean(
        event.archiveStart || live?.actualEndTime
      );

      const eventElement = document.createElement("div");

      eventElement.className =
        `event ${isLive ? "live" : isArchive ? "archive" : "upcoming"}`;

      const link = document.createElement("a");
      link.href =
        `https://www.youtube.com/watch?v=${encodeURIComponent(event.id)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = event.snippet?.title || "タイトル不明";

      eventElement.appendChild(link);

      eventElement.addEventListener("mouseenter", () => {
        showEventDetails(event);
      });

      eventElement.addEventListener("focusin", () => {
        showEventDetails(event);
      });

      cell.appendChild(eventElement);
    });

    grid.appendChild(cell);
  }

  calendar.appendChild(grid);
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

  thumbnailContainer.innerHTML = "";
  infoContainer.innerHTML = "";

  const thumb =
    event.snippet?.thumbnails?.high?.url ||
    event.snippet?.thumbnails?.medium?.url ||
    event.snippet?.thumbnails?.default?.url;

  if (thumb) {
    const image = document.createElement("img");
    image.src = thumb;
    image.alt = "";
    thumbnailContainer.appendChild(image);
  }

  const heading = document.createElement("h3");
  heading.textContent = event.snippet?.title || "タイトル不明";

  const link = document.createElement("a");
  link.href =
    `https://www.youtube.com/watch?v=${encodeURIComponent(event.id)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "YouTubeで見る";

  infoContainer.append(heading, link);
}

/* ------------------------------
   初期化
------------------------------ */
async function init() {
  if (isLoading) return;

  isLoading = true;
  showStatus("配信情報を読み込み中…");

  try {
    allEvents = await fetchAllEvents();

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
  }
}

init();
