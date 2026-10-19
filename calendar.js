const API_KEY = "AIzaSyCmPoAEOooOsvgJo9724J3NooRC13lS8f4"; 
const CHANNEL_ID = "UCqXxS-9x9Ha_UiH6hG4kh5Q";

/* 配信予定 + ライブ中 */
async function fetchUpcomingAndLive() {
  const url = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${CHANNEL_ID}&eventType=upcoming&type=video&key=${API_KEY}`;
  const upcomingRes = await fetch(url).then(r => r.json());

  const liveUrl = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
  const liveRes = await fetch(liveUrl).then(r => r.json());

  const ids = [
    ...upcomingRes.items.map(i => i.id.videoId),
    ...liveRes.items.map(i => i.id.videoId)
  ];

  if (ids.length === 0) return [];

  const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${ids.join(",")}&key=${API_KEY}`;
  const detailRes = await fetch(detailUrl).then(r => r.json());

  return detailRes.items;
}

/* アーカイブ（ライブ配信の過去動画） */
async function fetchArchives() {
  const url = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${CHANNEL_ID}&type=video&order=date&maxResults=30&key=${API_KEY}`;
  const res = await fetch(url).then(r => r.json());

  const ids = res.items.map(i => i.id.videoId);
  if (ids.length === 0) return [];

  const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${ids.join(",")}&key=${API_KEY}`;
  const detailRes = await fetch(detailUrl).then(r => r.json());

  /* ライブ配信のアーカイブは liveStreamingDetails が無いことがあるので publishedAt も使う */
  return detailRes.items.map(v => {
    const live = v.liveStreamingDetails;

    const start =
      (live && (live.actualEndTime || live.actualStartTime)) ||
      v.snippet.publishedAt; // ← ここが重要

    return {
      ...v,
      archiveStart: start
    };
  });
}

let current = new Date();

/* カレンダー描画 */
function renderCalendar(events) {
  const year = current.getFullYear();
  const month = current.getMonth();

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";

  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <button id="prev">←</button>
    <span>${year}年 ${month + 1}月</span>
    <button id="next">→</button>
  `;
  calendar.appendChild(header);

  document.getElementById("prev").onclick = () => {
    current.setMonth(current.getMonth() - 1);
    init();
  };
  document.getElementById("next").onclick = () => {
    current.setMonth(current.getMonth() + 1);
    init();
  };

  const grid = document.createElement("div");
  grid.className = "grid";

  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    const cell = document.createElement("div");
    cell.className = "cell";

    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      cell.classList.add("today");
    }

    cell.innerHTML = `<div class="day">${d}</div>`;

    const dayEvents = events.filter(ev => {
      const live = ev.liveStreamingDetails;

      const start =
        (live && (live.scheduledStartTime || live.actualStartTime || live.actualEndTime)) ||
        ev.archiveStart; // ← アーカイブ対応

      if (!start) return false;

      const evDate = new Date(start);
      return evDate.toDateString() === date.toDateString();
    });

    dayEvents.forEach(ev => {
      const live = ev.liveStreamingDetails;
      const isLive = live && live.actualStartTime && !live.actualEndTime;
      const isArchive = ev.archiveStart && (!live || live.actualEndTime);

      cell.innerHTML += `
        <div class="event ${isLive ? "live" : isArchive ? "archive" : "upcoming"}">
          <a href="https://www.youtube.com/watch?v=${ev.id}" target="_blank">
            ${ev.snippet.title}
          </a>
        </div>
      `;
    });

    grid.appendChild(cell);
  }

  calendar.appendChild(grid);
}

/* 初期化 */
async function init() {
  const upcomingAndLive = await fetchUpcomingAndLive();
  const archives = await fetchArchives();

  const allEvents = [...upcomingAndLive, ...archives];

  renderCalendar(allEvents);
}

init();
