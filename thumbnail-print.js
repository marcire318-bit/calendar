
(() => {
  "use strict";

  const STORAGE_KEY = "streamCalendarPrintList_v1";
  const THUMB_WIDTH = 40;
  const THUMB_HEIGHT = 22;
  const COLUMNS = 4;
  const ROWS = 5;

  let printList = loadPrintList();
  let modal = null;

  function loadPrintList() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function savePrintList() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(printList));
    updatePrintButtonLabels();
  }

  function getEventTitle(event) {
    return event.snippet?.title || event.title || "タイトル不明";
  }

  function getEventThumbnail(event) {
    try {
      return typeof getThumbnail === "function"
        ? getThumbnail(event)
        : event.snippet?.thumbnails?.high?.url ||
          event.snippet?.thumbnails?.medium?.url ||
          event.snippet?.thumbnails?.default?.url ||
          "";
    } catch {
      return "";
    }
  }

  function getEventDate(event) {
    try {
      const value = typeof getEventStart === "function"
        ? getEventStart(event)
        : event.manualDate || event.snippet?.publishedAt || "";

      if (!value) return "";

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";

      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
    } catch {
      return "";
    }
  }

  function makePrintItem(event) {
    return {
      id: String(event.id || ""),
      title: getEventTitle(event),
      thumbnail: getEventThumbnail(event),
      date: getEventDate(event)
    };
  }

  function addEvent(event) {
    const item = makePrintItem(event);

    if (!item.id || !item.thumbnail) {
      alert("この配信のサムネイルを取得できませんでした。");
      return;
    }

    if (printList.some(saved => saved.id === item.id)) {
      alert("このサムネイルは、すでに印刷リストに入っています。");
      return;
    }

    printList.push(item);
    savePrintList();
    alert("印刷リストに追加しました！");
    renderModalContent();
  }

  function addEvents(events) {
    let added = 0;

    for (const event of events) {
      const item = makePrintItem(event);

      if (
        item.id &&
        item.thumbnail &&
        !printList.some(saved => saved.id === item.id)
      ) {
        printList.push(item);
        added++;
      }
    }

    savePrintList();
    renderModalContent();
    alert(`${added}件を印刷リストに追加しました。`);
  }

  function removeItem(id) {
    printList = printList.filter(item => item.id !== id);
    savePrintList();
    renderModalContent();
  }

  function updatePrintButtonLabels() {
    document.querySelectorAll("[data-thumbnail-print-open]").forEach(button => {
      button.textContent = `▧ 印刷 (${printList.length})`;
    });

    document.querySelectorAll("[data-thumbnail-print-add]").forEach(button => {
      const id = button.dataset.thumbnailPrintAdd;
      const alreadyAdded = printList.some(item => item.id === id);
      button.textContent = alreadyAdded
        ? "印刷リストに追加済み"
        : "印刷リストに追加";
      button.disabled = alreadyAdded;
    });
  }

  function addButtonStyles() {
    if (document.getElementById("thumbnail-print-styles")) return;

    const style = document.createElement("style");
    style.id = "thumbnail-print-styles";
    style.textContent = `
      .thumbnail-print-button {
        margin: 6px 4px;
        padding: 8px 12px;
        border: 1px solid #777;
        border-radius: 8px;
        background: #fff;
        color: #222;
        cursor: pointer;
        font: inherit;
      }

      .thumbnail-print-button:disabled {
        opacity: .55;
        cursor: default;
      }

      #thumbnail-print-overlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, .55);
      }

      #thumbnail-print-dialog {
        width: min(760px, 100%);
        max-height: 90vh;
        overflow: auto;
        padding: 20px;
        border-radius: 12px;
        background: #fff;
        color: #222;
        box-sizing: border-box;
      }

      #thumbnail-print-dialog h2 {
        margin-top: 0;
      }

      .thumbnail-print-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0;
      }

      .thumbnail-print-list,
      .thumbnail-print-month-list {
        display: grid;
        gap: 8px;
      }

      .thumbnail-print-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 8px;
      }

      .thumbnail-print-row img {
        width: 88px;
        height: 50px;
        flex: 0 0 auto;
        object-fit: contain;
        background: #eee;
      }

      .thumbnail-print-row .thumbnail-print-row-title {
        flex: 1;
        overflow-wrap: anywhere;
        font-size: 13px;
      }

      .thumbnail-print-row button {
        flex: 0 0 auto;
      }

      .thumbnail-print-month-list label {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border-bottom: 1px solid #ddd;
        overflow-wrap: anywhere;
      }

      .thumbnail-print-month-list img {
        width: 72px;
        height: 40px;
        object-fit: contain;
        background: #eee;
      }

      .thumbnail-print-status {
        margin: 8px 0;
        font-size: 13px;
        color: #555;
      }

      @media (max-width: 480px) {
        #thumbnail-print-dialog {
          padding: 12px;
        }

        .thumbnail-print-row {
          flex-wrap: wrap;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createModal() {
    if (modal) return;

    const overlay = document.createElement("div");
    overlay.id = "thumbnail-print-overlay";

    overlay.innerHTML = `
      <section id="thumbnail-print-dialog" role="dialog"
        aria-modal="true" aria-labelledby="thumbnail-print-heading">
        <h2 id="thumbnail-print-heading">サムネイル印刷</h2>
        <p class="thumbnail-print-status">
          印刷リスト：<strong data-print-count>0</strong>件
          （2L判・横向き・1ページ20枚）
        </p>

        <div class="thumbnail-print-actions">
          <button type="button" class="thumbnail-print-button"
            data-action="select-month">表示月から選ぶ</button>
          <button type="button" class="thumbnail-print-button"
            data-action="print">印刷する</button>
          <button type="button" class="thumbnail-print-button"
            data-action="clear">リストを空にする</button>
          <button type="button" class="thumbnail-print-button"
            data-action="close">閉じる</button>
        </div>

        <div data-month-selection hidden>
          <h3>表示月の配信を選択</h3>
          <div class="thumbnail-print-actions">
            <button type="button" class="thumbnail-print-button"
              data-action="check-all">すべて選択</button>
            <button type="button" class="thumbnail-print-button"
              data-action="uncheck-all">すべて解除</button>
            <button type="button" class="thumbnail-print-button"
              data-action="add-selected">選択した配信を追加</button>
          </div>
          <div class="thumbnail-print-month-list"></div>
        </div>

        <h3>印刷リスト</h3>
        <div class="thumbnail-print-list"></div>
      </section>
    `;

    document.body.appendChild(overlay);
    modal = overlay;

    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeModal();
    });

    overlay.querySelector('[data-action="close"]').addEventListener(
      "click", closeModal
    );

    overlay.querySelector('[data-action="select-month"]').addEventListener(
      "click", showMonthSelection
    );

    overlay.querySelector('[data-action="print"]').addEventListener(
      "click", printThumbnails
    );

    overlay.querySelector('[data-action="clear"]').addEventListener(
      "click", () => {
        if (!printList.length) return;
        if (!confirm("印刷リストをすべて空にしますか？")) return;
        printList = [];
        savePrintList();
        renderModalContent();
      }
    );

    overlay.querySelector('[data-action="check-all"]').addEventListener(
      "click", () => {
        overlay.querySelectorAll('[data-month-event]').forEach(input => {
          input.checked = true;
        });
      }
    );

    overlay.querySelector('[data-action="uncheck-all"]').addEventListener(
      "click", () => {
        overlay.querySelectorAll('[data-month-event]').forEach(input => {
          input.checked = false;
        });
      }
    );

    overlay.querySelector('[data-action="add-selected"]').addEventListener(
      "click", () => {
        const selectedIds = new Set(
          [...overlay.querySelectorAll('[data-month-event]:checked')]
            .map(input => input.value)
        );

        const events = getCurrentMonthEvents().filter(event =>
          selectedIds.has(String(event.id))
        );

        addEvents(events);
      }
    );
  }

  function openModal() {
    createModal();
    renderModalContent();
    modal.style.display = "flex";
  }

  function closeModal() {
    if (modal) modal.style.display = "none";
  }

  function getCurrentMonthEvents() {
    if (!Array.isArray(allEvents) || !(current instanceof Date)) return [];

    const year = current.getFullYear();
    const month = current.getMonth();

    return allEvents.filter(event => {
      const dateText = getEventDate(event);
      if (!dateText) return false;

      const date = new Date(`${dateText}T12:00:00`);
      return date.getFullYear() === year && date.getMonth() === month;
    }).filter(event => getEventThumbnail(event));
  }

  function showMonthSelection() {
    const section = modal.querySelector("[data-month-selection]");
    section.hidden = !section.hidden;

    if (section.hidden) return;

    const list = section.querySelector(".thumbnail-print-month-list");
    list.innerHTML = "";

    const events = getCurrentMonthEvents();

    if (!events.length) {
      list.textContent = "表示月に選択できる配信がありません。";
      return;
    }

    for (const event of events) {
      const item = makePrintItem(event);
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.id;
      checkbox.dataset.monthEvent = "true";
      checkbox.checked = false;

      const image = document.createElement("img");
      image.src = item.thumbnail;
      image.alt = "";
      image.loading = "lazy";

      const title = document.createElement("span");
      title.textContent = `${item.date || "日付不明"}　${item.title}`;

      label.append(checkbox, image, title);
      list.appendChild(label);
    }
  }

  function renderModalContent() {
    if (!modal) return;

    modal.querySelector("[data-print-count]").textContent = printList.length;

    const list = modal.querySelector(".thumbnail-print-list");
    list.innerHTML = "";

    if (!printList.length) {
      list.textContent = "印刷リストは空です。配信詳細または月別選択から追加してください。";
    } else {
      printList.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "thumbnail-print-row";

        const image = document.createElement("img");
        image.src = item.thumbnail;
        image.alt = "";
        image.loading = "lazy";

        const title = document.createElement("span");
        title.className = "thumbnail-print-row-title";
        title.textContent = `${index + 1}. ${item.title}`;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "thumbnail-print-button";
        remove.textContent = "削除";
        remove.addEventListener("click", () => removeItem(item.id));

        row.append(image, title, remove);
        list.appendChild(row);
      });
    }

    updatePrintButtonLabels();
  }

  
async function printThumbnails() {
  if (!printList.length) {
    alert("印刷リストにサムネイルを追加してください。");
    return;
  }

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    alert("印刷画面が開けませんでした。ブラウザのポップアップを許可してください。");
    return;
  }

  // 元画像はそのまま使い、印刷時の表示方法で黒帯を避ける
  const processedImages = await Promise.all(
  printList.map(item => processThumbnailForPrint(item.thumbnail))
);

  const pageSize = 20;
  const pages = [];

  for (let i = 0; i < processedImages.length; i += pageSize) {
    pages.push(processedImages.slice(i, i + pageSize));
  }

  const pageHtml = pages.map(images => {
    const cells = images.map(src => `
      <div class="thumb-cell">
        <img src="${escapeAttribute(src)}" alt="">
      </div>
    `).join("");

    return `<section class="print-page">${cells}</section>`;
  }).join("");

  printWindow.document.open();
  printWindow.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>サムネイル印刷</title>
<style>
  @page {
    size: 178mm 127mm;
    margin: 3mm;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
  }

  .print-page {
    width: 172mm;
    height: 121mm;
    display: grid;
    grid-template-columns: repeat(4, 40mm);
    grid-template-rows: repeat(5, 22.5mm);
    gap: 2mm;
    align-content: start;
    justify-content: start;
    break-after: page;
    page-break-after: always;
    overflow: hidden;
  }

  .print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  .thumb-cell {
    width: 40mm;
    height: 22.5mm;
    overflow: hidden;
  }

 .thumb-cell img {
  display: block;
  width: 40mm;
  height: 22.5mm;
  object-fit: cover;
}

  @media screen {
    body {
      padding: 10px;
      background: #ddd;
    }

    .print-page {
      margin: 0 auto 12px;
      background: white;
      box-shadow: 0 1px 6px #999;
    }
  }
</style>
</head>
<body>
${pageHtml}
<script>
  window.addEventListener("load", async () => {
    const images = Array.from(document.images);
    
images.forEach(img => {
  const applyFit = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;

    const ratio = img.naturalWidth / img.naturalHeight;

    // 縦長のShortsは切り取らず、全体を表示する
    img.style.objectFit = ratio < 1.4 ? "contain" : "cover";
  };

if (img.complete && img.naturalWidth > 0) {
  applyFit();
} else {
  img.addEventListener("load", applyFit, { once: true });
}

    await Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();

      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));

    setTimeout(() => {
      window.focus();
      window.print();
    }, 1000);
  });
<\/script>
</body>
</html>`);
  printWindow.document.close();
}

async function processThumbnailForPrint(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        const ratio = width / height;

        // Shortsなどの縦長画像は加工しない
        if (ratio < 1.4) {
          resolve(url);
          return;
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0);

        const pixels = ctx.getImageData(0, 0, width, height).data;

        // 画像の横方向を複数箇所調べ、黒い行か判定する
        function isBlackRow(y) {
          const sampleCount = 80;
          let blackCount = 0;

          for (let i = 0; i < sampleCount; i++) {
            const x = Math.floor(i * (width - 1) / (sampleCount - 1));
            const p = (y * width + x) * 4;

            if (
              pixels[p] < 35 &&
              pixels[p + 1] < 35 &&
              pixels[p + 2] < 35
            ) {
              blackCount++;
            }
          }

          return blackCount / sampleCount > 0.9;
        }

        let top = 0;
        let bottom = height - 1;

        // 上下それぞれ最大25%まで調べる
        while (top < height * 0.25 && isBlackRow(top)) {
          top++;
        }

        while (bottom > height * 0.75 && isBlackRow(bottom)) {
          bottom--;
        }

        const cropHeight = bottom - top + 1;

        // 黒帯がない、または検出結果が不自然なら元画像を使う
        if (
          top === 0 &&
          bottom === height - 1
        ) {
          resolve(url);
          return;
        }

        if (cropHeight < height * 0.5) {
          resolve(url);
          return;
        }

        // 黒帯を取り除いた画像を生成
        const output = document.createElement("canvas");
        output.width = width;
        output.height = cropHeight;

        output.getContext("2d").drawImage(
          image,
          0, top, width, cropHeight,
          0, 0, width, cropHeight
        );

        resolve(output.toDataURL("image/jpeg", 0.95));
      } catch (error) {
        console.warn("サムネイル加工に失敗:", error);
        resolve(url);
      }
    };

    image.onerror = () => resolve(url);
    image.src = url;
  });
}

  function escapeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function addPrintListButton() {
    const header = document.querySelector("#calendar .header");
    if (!header || header.querySelector("[data-thumbnail-print-open]")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "add-button";
    button.dataset.thumbnailPrintOpen = "true";
    button.addEventListener("click", openModal);
    header.appendChild(button);

    updatePrintButtonLabels();
  }

  function addDetailAddButton() {
    const info = document.getElementById("detail-info");
    if (!info || !info.querySelector("h3")) return;

    const title = info.querySelector("h3").textContent;
    const event = Array.isArray(allEvents)
      ? allEvents.find(item =>
          String(item.id) === String(selectedEventId) &&
          getEventTitle(item) === title
        ) || allEvents.find(item =>
          String(item.id) === String(selectedEventId)
        )
      : null;

    if (!event || info.querySelector("[data-thumbnail-print-add]")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumbnail-print-button";
    button.dataset.thumbnailPrintAdd = String(event.id);
    button.addEventListener("click", () => addEvent(event));

    info.appendChild(button);
    updatePrintButtonLabels();
  }

  function attachObservers() {
    const calendar = document.getElementById("calendar");
    const info = document.getElementById("detail-info");

    if (calendar) {
      new MutationObserver(() => {
        addPrintListButton();
      }).observe(calendar, { childList: true, subtree: true });
      addPrintListButton();
    }

    if (info) {
      new MutationObserver(() => {
        addDetailAddButton();
      }).observe(info, { childList: true, subtree: true });
      addDetailAddButton();
    }
  }

  function start() {
    addButtonStyles();
    createModal();
    attachObservers();
    updatePrintButtonLabels();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

