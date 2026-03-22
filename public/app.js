/**
 * app.js - フロントエンドロジック
 * 設定の読み込み・保存、ログ表示、手動実行
 */

// ── 初期化 ──────────────────────────────────────
let currentSettings = {};

async function init() {
  updateClock();
  setInterval(updateClock, 1000);
  await loadSettings();
  await loadLogs();
  setInterval(loadLogs, 10000); // 10秒毎にログ更新
  checkStatus();
  setInterval(checkStatus, 30000);
}

// ── 時計 ──────────────────────────────────────
function updateClock() {
  const el = document.getElementById("currentTime");
  if (el) {
    el.textContent = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  }
}

// ── サーバーステータス確認 ──────────────────────────────────────
async function checkStatus() {
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const data = await res.json();
      dot.className = "status-dot online";
      text.textContent = `稼働中 (起動: ${formatUptime(data.uptime)})`;
    } else {
      throw new Error();
    }
  } catch {
    dot.className = "status-dot offline";
    text.textContent = "サーバーに接続できません";
  }
}

function formatUptime(sec) {
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分`;
  return `${Math.floor(sec / 3600)}時間${Math.floor((sec % 3600) / 60)}分`;
}

// ── 設定 読み込み ──────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    currentSettings = await res.json();
    applySettingsToUI(currentSettings);
  } catch (err) {
    console.error("設定取得エラー:", err);
  }
}

function applySettingsToUI(settings) {
  // チェックボックス / トグル
  for (const el of document.querySelectorAll("input[type='checkbox'][data-key]")) {
    const key = el.dataset.key;
    if (key in settings) {
      el.checked = settings[key] === "true";
    }
    // カードのハイライト
    if (key.endsWith(".enabled")) {
      const taskName = key.replace(".enabled", "");
      const card = document.getElementById(`card-${taskName}`);
      if (card) card.classList.toggle("enabled", el.checked);
      el.addEventListener("change", () => {
        card?.classList.toggle("enabled", el.checked);
      });
    }
  }

  // テキスト / 数値 入力
  for (const el of document.querySelectorAll("input[type='text'][data-key], input[type='number'][data-key]")) {
    const key = el.dataset.key;
    if (key in settings) {
      el.value = settings[key];
    }
  }
}

// ── 設定 保存 ──────────────────────────────────────
async function saveSettings() {
  const btn = document.getElementById("saveBtn");
  const msg = document.getElementById("saveMsg");
  btn.disabled = true;

  const updates = {};

  for (const el of document.querySelectorAll("[data-key]")) {
    const key = el.dataset.key;
    if (!key) continue;
    if (el.type === "checkbox") {
      updates[key] = String(el.checked);
    } else {
      updates[key] = el.value;
    }
  }

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      msg.textContent = "✅ 保存しました";
      msg.classList.add("show");
      setTimeout(() => msg.classList.remove("show"), 3000);
      currentSettings = updates;
    } else {
      throw new Error("保存失敗");
    }
  } catch (err) {
    msg.textContent = "❌ 保存に失敗しました";
    msg.style.color = "var(--red)";
    msg.classList.add("show");
    setTimeout(() => msg.classList.remove("show"), 3000);
  } finally {
    btn.disabled = false;
  }
}

// ── 手動実行 ──────────────────────────────────────
async function runTask(taskName) {
  const btn = event.currentTarget || event.target;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ 実行中...";

  try {
    const res = await fetch(`/api/run/${taskName}`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      showToast(`✅ ${data.message}`, "success");
    } else {
      showToast(`❌ エラー: ${data.error}`, "error");
    }
  } catch {
    showToast("❌ サーバーに接続できません", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
    setTimeout(loadLogs, 2000);
  }
}

// ── ログ表示 ──────────────────────────────────────
async function loadLogs() {
  try {
    const res = await fetch("/api/logs?limit=100");
    const logs = await res.json();
    renderLogs(logs);
  } catch {
    // サイレント失敗
  }
}

function renderLogs(logs) {
  const container = document.getElementById("logContainer");
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="log-empty">ログがありません</div>';
    return;
  }

  container.innerHTML = logs
    .map((log) => `
      <div class="log-entry">
        <span class="log-time">${log.created_at ?? ""}</span>
        <span class="log-task">${log.task ?? ""}</span>
        <span class="log-level ${log.level}">${log.level ?? ""}</span>
        <span class="log-msg">${escapeHtml(log.message ?? "")}</span>
      </div>
    `)
    .join("");
}

async function clearLogs() {
  if (!confirm("ログをすべて消去しますか？")) return;
  await fetch("/api/logs", { method: "DELETE" });
  await loadLogs();
}

// ── ユーティリティ ──────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: ${type === "error" ? "#7f1d1d" : "#14532d"};
    color: white; padding: 12px 20px; border-radius: 8px;
    font-size: 14px; font-weight: 600; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── 起動 ──────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);
