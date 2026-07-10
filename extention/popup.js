/**
 * BrowserAide - Popup UI Controller
 * Compact product panel for extention_v2.
 */

const instructionEl = document.getElementById("instruction");
const inputError = document.getElementById("input-error");
const startBtn = document.getElementById("start-btn");
const resumeBtn = document.getElementById("resume-btn");
const resetBtn = document.getElementById("reset-btn");
const clearLogsBtn = document.getElementById("clear-logs-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsDrawer = document.getElementById("settings-drawer");
const settingsCloseBtn = document.getElementById("settings-close");
const settingsTabBtns = document.querySelectorAll(".settings-tab");
const settingsPanes = document.querySelectorAll(".settings-pane");
const openFullGuideBtn = document.getElementById("open-full-guide");
const settingsMaxSteps = document.getElementById("settings-max-steps");
const settingsRetryLimit = document.getElementById("settings-retry-limit");
const settingsPageWaitTime = document.getElementById("settings-page-wait-time");
const settingsApiKey = document.getElementById("settings-api-key");
const settingsBaseUrl = document.getElementById("settings-base-url");
const settingsModelName = document.getElementById("settings-model-name");
const settingsTestVlmBtn = document.getElementById("settings-test-vlm");
const settingsVlmTestStatus = document.getElementById("settings-vlm-test-status");
const quickStartLink = document.getElementById("quick-start-link");
const githubLink = document.getElementById("github-link");
const statusBadge = document.getElementById("status-badge");
const modeTrack = document.querySelector(".mode-track");
const modeBtns = document.querySelectorAll(".mode-btn");
const suggestionBtns = document.querySelectorAll(".suggestion-chip");

const runDot = document.getElementById("run-dot");
const progressSection = document.getElementById("progress-section");
const currentStepEl = document.getElementById("current-step");
const progressStatus = document.getElementById("progress-status");
const progressFill = document.getElementById("progress-fill");
const thoughtSection = document.getElementById("thought-section");
const thoughtContent = document.getElementById("thought-content");
const actionSection = document.getElementById("action-output-section");
const actionContent = document.getElementById("action-content");
const answerSection = document.getElementById("answer-section");
const answerContent = document.getElementById("answer-content");
const logsContainer = document.getElementById("logs-container");
const pauseAlert = document.getElementById("pause-alert");
const pauseReason = document.getElementById("pause-reason");
const streamingIndicator = document.getElementById("streaming-indicator");

let pollInterval = null;
let backendStatusInterval = null;
let backendCheckInFlight = false;
let lastLogCount = 0;
let userScrolling = false;
let currentMode = "hybrid";
let isStreaming = false;
let lastStreamingThought = "";

const SETTINGS_KEY = "popupSettings";
const defaultSettings = {
  maxSteps: "20",
  retryLimit: "3",
  pageWaitTime: "8000",
  apiKey: "",
  baseUrl: "",
  modelName: ""
};

const PlayIcon = `<span class="btn-icon">▶</span>`;
const StopIcon = `<span class="btn-icon">■</span>`;

function openInNewTab(url) {
  const targetUrl = url.startsWith("http") ? url : chrome.runtime.getURL(url);

  try {
    const result = chrome.tabs?.create?.({ url: targetUrl });
    if (result?.catch) {
      result.catch(() => window.open(targetUrl, "_blank", "noopener"));
    }
  } catch (_error) {
    window.open(targetUrl, "_blank", "noopener");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await initSettingsDrawer();
  initModeButtons();
  initEventListeners();
  checkBackendStatus();
  refreshState();
  pollInterval = setInterval(refreshState, 300);
  backendStatusInterval = setInterval(pollBackendStatus, 3000);

  logsContainer.addEventListener("scroll", () => {
    const distanceFromBottom = logsContainer.scrollHeight - logsContainer.scrollTop - logsContainer.clientHeight;
    userScrolling = distanceFromBottom >= 30;
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "LOG_UPDATE" && message.log) {
      appendLog(message.log);
      lastLogCount = message.totalLogs;
    }
    if (message.type === "STREAMING_THOUGHT") {
      updateStreamingThought(message.content, message.isComplete);
    }
    if (message.type === "STREAMING_ANSWER") {
      updateStreamingAnswer(message.content, message.isComplete);
    }
  });
});

function initModeButtons() {
  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => setControlMode(btn.dataset.mode));
  });

  chrome.runtime.sendMessage({ type: "GET_MODE" }, (res) => {
    updateModeUI(res?.ok && res.mode ? res.mode : "hybrid");
  });
}

function checkBackendStatus({ silent = false } = {}) {
  if (backendCheckInFlight) return;

  backendCheckInFlight = true;
  if (!silent) {
    updateStatusBadge({ backendAvailable: null, isRunning: false, isPaused: false, status: "Checking backend..." });
  }

  chrome.runtime.sendMessage({ type: "CHECK_BACKEND", silent }, () => {
    backendCheckInFlight = false;
    refreshState();
  });
}

async function pollBackendStatus() {
  const state = await getState();
  if (state.isRunning || state.isPaused) return;
  checkBackendStatus({ silent: true });
}

function setControlMode(mode) {
  chrome.runtime.sendMessage({ type: "SET_MODE", mode }, (res) => {
    if (res?.ok) updateModeUI(mode);
  });
}

function updateModeUI(mode) {
  currentMode = mode;
  modeBtns.forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("mode-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  modeTrack?.setAttribute("data-active", mode);
}

function initEventListeners() {
  startBtn.addEventListener("click", handleStartStop);
  resetBtn.addEventListener("click", handleReset);
  resumeBtn.addEventListener("click", handleResume);
  settingsBtn.addEventListener("click", openSettingsDrawer);
  settingsCloseBtn?.addEventListener("click", closeSettingsDrawer);
  settingsDrawer?.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.closeDrawer === "true") {
      closeSettingsDrawer();
    }
  });
  openFullGuideBtn?.addEventListener("click", () => {
    closeSettingsDrawer();
    openInNewTab("help.html");
  });
  quickStartLink?.addEventListener("click", () => {
    openInNewTab("help.html");
  });
  githubLink?.addEventListener("click", () => {
    openInNewTab("https://github.com/lnennnn/BrowserAide");
  });
  settingsTestVlmBtn?.addEventListener("click", handleTestVlmEndpoint);
  clearLogsBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleClearLogs();
  });

  instructionEl.addEventListener("input", () => setInputError(false));
  instructionEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleStartStop();
    }
  });

  suggestionBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      instructionEl.value = btn.dataset.example || btn.textContent.trim();
      setInputError(false);
      instructionEl.focus();
    });
  });
}


function openSettingsDrawer() {
  settingsDrawer?.classList.remove("hidden");
  settingsDrawer?.setAttribute("aria-hidden", "false");
  settingsCloseBtn?.focus();
}

function closeSettingsDrawer() {
  settingsDrawer?.classList.add("hidden");
  settingsDrawer?.setAttribute("aria-hidden", "true");
}

function switchSettingsTab(tab) {
  settingsTabBtns.forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  settingsPanes.forEach((pane) => {
    pane.classList.toggle("hidden", pane.id !== `settings-pane-${tab}`);
  });
}

function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
      resolve({ ...defaultSettings, ...(result?.[SETTINGS_KEY] || {}) });
    });
  });
}

function saveStoredSettings(nextSettings) {
  chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
}

async function initSettingsDrawer() {
  const settings = await getStoredSettings();

  if (settingsMaxSteps) settingsMaxSteps.value = settings.maxSteps || "";
  if (settingsRetryLimit) settingsRetryLimit.value = settings.retryLimit || "";
  if (settingsPageWaitTime) settingsPageWaitTime.value = settings.pageWaitTime || "";
  if (settingsApiKey) settingsApiKey.value = settings.apiKey || "";
  if (settingsBaseUrl) settingsBaseUrl.value = settings.baseUrl || "";
  if (settingsModelName) settingsModelName.value = settings.modelName || "";

  settingsTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchSettingsTab(btn.dataset.tab || "general"));
  });

  settingsMaxSteps?.addEventListener("change", async () => {
    const settingsState = await getStoredSettings();
    settingsState.maxSteps = settingsMaxSteps.value.trim();
    saveStoredSettings(settingsState);
  });

  settingsRetryLimit?.addEventListener("change", async () => {
    const settingsState = await getStoredSettings();
    settingsState.retryLimit = settingsRetryLimit.value.trim();
    saveStoredSettings(settingsState);
  });

  settingsPageWaitTime?.addEventListener("change", async () => {
    const settingsState = await getStoredSettings();
    settingsState.pageWaitTime = settingsPageWaitTime.value.trim();
    saveStoredSettings(settingsState);
  });

  settingsApiKey?.addEventListener("change", async () => {
    const settingsState = await getStoredSettings();
    settingsState.apiKey = settingsApiKey.value.trim();
    saveStoredSettings(settingsState);
  });

  settingsBaseUrl?.addEventListener("change", async () => {
    const settingsState = await getStoredSettings();
    settingsState.baseUrl = settingsBaseUrl.value.trim();
    saveStoredSettings(settingsState);
  });

  settingsModelName?.addEventListener("change", async () => {
    const settingsState = await getStoredSettings();
    settingsState.modelName = settingsModelName.value.trim();
    saveStoredSettings(settingsState);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettingsDrawer();
  });

  switchSettingsTab("general");
}

async function handleStartStop() {
  const state = await getState();

  if (state.isRunning) {
    chrome.runtime.sendMessage({ type: "STOP_TASK" });
    updateStartButton({ isRunning: false, isPaused: false, status: "Ready" });
    return;
  }

  const instruction = instructionEl.value.trim();
  if (!instruction) {
    setInputError(true);
    instructionEl.focus();
    return;
  }

  const settings = await collectCurrentSettings();
  saveStoredSettings(settings);

  chrome.runtime.sendMessage({ type: "START_TASK", instruction, settings });
  updateStartButton({ isRunning: true, isPaused: false, status: "Processing" });
}

async function collectCurrentSettings() {
  const settings = await getStoredSettings();
  settings.maxSteps = settingsMaxSteps?.value.trim() || settings.maxSteps;
  settings.retryLimit = settingsRetryLimit?.value.trim() || settings.retryLimit;
  settings.pageWaitTime = settingsPageWaitTime?.value.trim() || settings.pageWaitTime;
  settings.apiKey = settingsApiKey?.value.trim() || settings.apiKey;
  settings.baseUrl = settingsBaseUrl?.value.trim() || settings.baseUrl;
  settings.modelName = settingsModelName?.value.trim() || settings.modelName;
  return settings;
}

async function handleTestVlmEndpoint() {
  const settings = await collectCurrentSettings();
  saveStoredSettings(settings);

  setVlmTestStatus("Testing endpoint...", "pending");
  if (settingsTestVlmBtn) settingsTestVlmBtn.disabled = true;

  chrome.runtime.sendMessage({ type: "TEST_VLM_ENDPOINT", settings }, (res) => {
    if (settingsTestVlmBtn) settingsTestVlmBtn.disabled = false;

    if (chrome.runtime.lastError) {
      setVlmTestStatus(chrome.runtime.lastError.message || "Test failed.", "error");
      return;
    }

    if (res?.ok) {
      const model = res.model ? ` · ${res.model}` : "";
      setVlmTestStatus(`Connected${model}`, "ok");
      return;
    }

    setVlmTestStatus(res?.error || "Connection failed.", "error");
  });
}

function setVlmTestStatus(message, state = "neutral") {
  if (!settingsVlmTestStatus) return;
  settingsVlmTestStatus.textContent = message;
  settingsVlmTestStatus.classList.toggle("is-ok", state === "ok");
  settingsVlmTestStatus.classList.toggle("is-error", state === "error");
}

function handleReset() {
  chrome.runtime.sendMessage({ type: "RESET_AGENT" }, (res) => {
    if (res?.ok) {
      resetUI();
      appendSyntheticLog("Agent reset complete", "info");
    } else {
      appendSyntheticLog(res?.error || "Reset failed", "error");
    }
  });
}

function handleResume() {
  chrome.runtime.sendMessage({ type: "RESUME_TASK" }, (res) => {
    if (res?.ok) {
      resumeBtn.classList.add("hidden");
      pauseAlert.classList.add("hidden");
    }
  });
}

function handleClearLogs() {
  chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
  logsContainer.innerHTML = emptyLogMarkup();
  lastLogCount = 0;
}

function getState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => resolve(state || {}));
  });
}

async function refreshState() {
  const state = await getState();
  updateUI(state);
}

function updateUI(state) {
  if (!state) return;

  updateStatusBadge(state);
  updateStartButton(state);
  instructionEl.disabled = Boolean(state.isRunning || state.isPaused);

  if (state.controlMode && state.controlMode !== currentMode) {
    updateModeUI(state.controlMode);
  }

  updatePauseState(state);
  updateRunPanel(state);
  updateResult(state);
  updateLogsFromState(state);
}

function updatePauseState(state) {
  if (state.isPaused) {
    pauseAlert.classList.remove("hidden");
    pauseReason.textContent = state.pauseReason || "Please complete the required action, then resume.";
    resumeBtn.classList.remove("hidden");
    startBtn.classList.add("hidden");
  } else {
    pauseAlert.classList.add("hidden");
    resumeBtn.classList.add("hidden");
    startBtn.classList.remove("hidden");
  }
}

function updateRunPanel(state) {
  const step = state.step || 0;
  const hasProgress = state.isRunning || state.isPaused || step > 0;
  currentStepEl.textContent = `Step ${step}`;
  progressSection.classList.toggle("is-active", hasProgress);
  progressStatus.textContent = sanitizeRunStatus(state.status || (hasProgress ? "Processing" : "Waiting for a task"));
  progressFill.style.width = hasProgress ? `${Math.min((step / 20) * 100, 100)}%` : "0%";

  runDot.className = "status-dot";
  if (state.isPaused) runDot.classList.add("status-paused");
  else if (state.isRunning) runDot.classList.add("status-running");
  else if (state.status?.startsWith("✅")) runDot.classList.add("status-done");
  else if (state.status?.startsWith("❌") || state.status?.startsWith("Error")) runDot.classList.add("status-error");
  else runDot.classList.add("status-idle");

  if (state.thought && !isStreaming && !state.finalAnswer) {
    thoughtSection.classList.remove("hidden");
    thoughtContent.classList.remove("streaming");
    thoughtContent.textContent = state.thought;
  } else if (!state.thought && !isStreaming) {
    thoughtSection.classList.add("hidden");
    thoughtContent.textContent = "";
  }

  if (state.action && !state.finalAnswer) {
    actionSection.classList.remove("hidden");
    actionContent.textContent = state.action;
  } else if (!state.action) {
    actionSection.classList.add("hidden");
    actionContent.textContent = "";
  }
}

function updateResult(state) {
  if (state.finalAnswer) {
    answerSection.classList.remove("hidden");
    answerContent.innerHTML = renderMarkdownSafe(state.finalAnswer);
    if (!state.isRunning) {
      thoughtSection.classList.add("hidden");
      actionSection.classList.add("hidden");
    }
  } else {
    answerSection.classList.add("hidden");
    answerContent.innerHTML = "";
  }
}

function updateLogsFromState(state) {
  if (state.logs && state.logs.length !== lastLogCount) {
    const hadNewLogs = state.logs.length > lastLogCount;
    updateLogs(state.logs);
    lastLogCount = state.logs.length;

    if (hadNewLogs && !userScrolling) {
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }
  }
}

function updateStatusBadge(state) {
  statusBadge.className = "badge";

  if (state.isPaused) {
    statusBadge.textContent = "Paused";
    statusBadge.classList.add("badge-paused");
  } else if (state.isRunning) {
    statusBadge.textContent = "Running";
    statusBadge.classList.add("badge-running");
  } else if (state.backendAvailable === null) {
    statusBadge.textContent = "Checking";
    statusBadge.classList.add("badge-checking");
  } else if (state.backendAvailable === false) {
    statusBadge.textContent = "Offline";
    statusBadge.classList.add("badge-error");
  } else if (state.status?.startsWith("✅")) {
    statusBadge.textContent = "Done";
    statusBadge.classList.add("badge-done");
  } else if (state.status?.startsWith("❌") || state.status?.startsWith("Error")) {
    statusBadge.textContent = "Error";
    statusBadge.classList.add("badge-error");
  } else {
    statusBadge.textContent = "Ready";
    statusBadge.classList.add("badge-ready");
  }
}

function updateStartButton(state) {
  const isPaused = Boolean(state?.isPaused);
  const isRunning = Boolean(state?.isRunning);
  const status = state?.status || "";

  if (isPaused) {
    startBtn.classList.add("hidden");
    return;
  }

  startBtn.classList.remove("hidden");
  if (isRunning) {
    startBtn.innerHTML = `${StopIcon}<span>Stop</span>`;
    startBtn.classList.add("running");
  } else if (status.startsWith("❌") || status.startsWith("Error")) {
    startBtn.innerHTML = `${PlayIcon}<span>Try again</span>`;
    startBtn.classList.remove("running");
  } else if (state?.finalAnswer || status.startsWith("✅")) {
    startBtn.innerHTML = `${PlayIcon}<span>Run again</span>`;
    startBtn.classList.remove("running");
  } else {
    startBtn.innerHTML = `${PlayIcon}<span>Start Task</span>`;
    startBtn.classList.remove("running");
  }
}

function setInputError(show) {
  inputError.classList.toggle("hidden", !show);
  instructionEl.classList.toggle("has-error", show);
}

function sanitizeRunStatus(status) {
  return String(status || "")
    .replace(/^[\s✅❌⚠️⏸️▶️🛑]+/u, "")
    .trim();
}

function appendLog(log) {
  const placeholder = logsContainer.querySelector(".log-placeholder");
  if (placeholder) placeholder.remove();

  const logEl = document.createElement("div");
  logEl.className = `log-entry log-${log.level}`;
  logEl.innerHTML = `
    <span class="log-time">${escapeHtml(log.timestamp || "")}</span>
    <span class="log-message">${escapeHtml(log.message || "")}</span>
  `;
  logsContainer.appendChild(logEl);

  if (!userScrolling) logsContainer.scrollTop = logsContainer.scrollHeight;
}

function updateLogs(logs) {
  if (!logs || logs.length === 0) {
    logsContainer.innerHTML = emptyLogMarkup();
    return;
  }

  logsContainer.innerHTML = logs.map(log => `
    <div class="log-entry log-${log.level}">
      <span class="log-time">${escapeHtml(log.timestamp || "")}</span>
      <span class="log-message">${escapeHtml(log.message || "")}</span>
    </div>
  `).join("");
}

function resetUI() {
  pauseAlert.classList.add("hidden");
  resumeBtn.classList.add("hidden");
  startBtn.classList.remove("hidden");
  thoughtSection.classList.add("hidden");
  actionSection.classList.add("hidden");
  answerSection.classList.add("hidden");
  thoughtContent.textContent = "";
  actionContent.textContent = "";
  answerContent.innerHTML = "";
  logsContainer.innerHTML = emptyLogMarkup();
  progressFill.style.width = "0%";
  progressStatus.textContent = "Waiting for a task";
  currentStepEl.textContent = "Step 0";
  runDot.className = "status-dot status-idle";
  lastLogCount = 0;
  instructionEl.disabled = false;
  updateStartButton({ isRunning: false, isPaused: false, status: "Ready" });
  updateStatusBadge({ isRunning: false, isPaused: false, status: "Ready" });
}

function appendSyntheticLog(message, level = "info") {
  appendLog({
    level,
    timestamp: new Date().toLocaleTimeString("en-US", { hour12: false }),
    message,
  });
}

function emptyLogMarkup() {
  return `<div class="log-placeholder"><span class="terminal-prompt">$</span> Waiting for commands...</div>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function safeUrl(url) {
  try {
    const u = new URL(url, "https://example.com");
    const protocol = u.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") return url;
    return null;
  } catch {
    return null;
  }
}

function renderInlineMarkdown(text) {
  // Escape first, then add a limited, safe set of tags.
  let s = escapeHtml(text);

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
    const safe = safeUrl(url.trim());
    if (!safe) return label;
    const href = escapeHtml(safe).replace(/"/g, "&quot;");
    return `<a class="md-link" href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  // Inline code: `code`
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code class="md-inline-code">${code}</code>`);

  // Bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);

  // Italic: *text* (simple)
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, (_m, prefix, t) => `${prefix}<em>${t}</em>`);

  return s;
}

function splitMarkdownTableRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);

  const cells = [];
  let cell = "";
  let escaped = false;
  for (const char of row) {
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function isMarkdownTableRow(line) {
  return line.includes("|") && splitMarkdownTableRow(line).length > 1;
}

function renderMarkdownTable(rows) {
  const header = splitMarkdownTableRow(rows[0]);
  const bodyRows = rows.slice(2).map(splitMarkdownTableRow);
  const columnCount = header.length;

  const renderCell = (cell, tag) => `<${tag}>${renderInlineMarkdown(cell)}</${tag}>`;
  const normalize = cells => Array.from({ length: columnCount }, (_, index) => cells[index] || "");

  return `
    <div class="md-table-wrap">
      <table class="md-table">
        <thead><tr>${normalize(header).map(cell => renderCell(cell, "th")).join("")}</tr></thead>
        <tbody>${bodyRows.map(row => `<tr>${normalize(row).map(cell => renderCell(cell, "td")).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderMarkdownBlock(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let paragraph = [];
  let list = null; // { type: 'ul'|'ol', items: [] }

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trimEnd();
    if (text) {
      html += `<p class="md-p">${renderInlineMarkdown(text).replace(/\n/g, "<br>")}</p>`;
    }
    paragraph = [];
  };

  const flushList = () => {
    if (!list || list.items.length === 0) {
      list = null;
      return;
    }
    const tag = list.type;
    html += `<${tag} class="md-${tag}">` + list.items.map(item => `<li class="md-li">${renderInlineMarkdown(item)}</li>`).join("") + `</${tag}>`;
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushList();
      flushParagraph();
      continue;
    }

    // Pipe tables:
    // | Name | Value |
    // | --- | --- |
    if (isMarkdownTableRow(trimmed) && lines[i + 1] && isMarkdownTableSeparator(lines[i + 1].trim())) {
      flushList();
      flushParagraph();
      const tableRows = [trimmed, lines[i + 1].trim()];
      i += 2;
      while (i < lines.length && lines[i].trim() && isMarkdownTableRow(lines[i].trim())) {
        tableRows.push(lines[i].trim());
        i += 1;
      }
      html += renderMarkdownTable(tableRows);
      i -= 1;
      continue;
    }

    // Headings: ### Title
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushList();
      flushParagraph();
      const level = h[1].length; // 1..3
      html += `<h${level} class="md-h${level}">${renderInlineMarkdown(h[2])}</h${level}>`;
      continue;
    }

    // Unordered list
    const ul = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      flushParagraph();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }

    // Ordered list: 1. item
    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushParagraph();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }

    // Normal paragraph line
    flushList();
    paragraph.push(line);
  }

  flushList();
  flushParagraph();
  return html;
}

function renderMarkdownSafe(md) {
  if (!md) return "";
  const text = String(md).replace(/\r\n/g, "\n");

  // Split by fenced code blocks.
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("```", i);
    if (start === -1) {
      parts.push({ type: "md", text: text.slice(i) });
      break;
    }

    if (start > i) {
      parts.push({ type: "md", text: text.slice(i, start) });
    }

    const fenceInfoEnd = text.indexOf("\n", start + 3);
    const end = text.indexOf("```", start + 3);
    if (end === -1) {
      parts.push({ type: "md", text: text.slice(start) });
      break;
    }

    const hasInfoLine = fenceInfoEnd !== -1 && fenceInfoEnd < end;
    const info = hasInfoLine ? text.slice(start + 3, fenceInfoEnd).trim() : "";
    const code = hasInfoLine ? text.slice(fenceInfoEnd + 1, end) : text.slice(start + 3, end);
    const lang = info.split(/\s+/)[0].replace(/[^\w-]/g, "");

    parts.push({ type: "code", lang, code });
    i = end + 3;
  }

  return parts.map(p => {
    if (p.type === "code") {
      const cls = p.lang ? `language-${p.lang}` : "";
      return `<pre class="md-pre"><code class="md-code ${cls}">${escapeHtml(p.code)}</code></pre>`;
    }
    return renderMarkdownBlock(p.text);
  }).join("");
}

function updateStreamingThought(content, isComplete = false) {
  thoughtSection.classList.remove("hidden");

  if (isComplete) {
    isStreaming = false;
    thoughtContent.classList.remove("streaming");
    streamingIndicator.classList.add("hidden");
    thoughtContent.textContent = content;
    lastStreamingThought = "";
  } else {
    isStreaming = true;
    thoughtContent.classList.add("streaming");
    streamingIndicator.classList.remove("hidden");
    thoughtContent.textContent = content;
    lastStreamingThought = content;
    thoughtContent.scrollTop = thoughtContent.scrollHeight;
  }
}

function updateStreamingAnswer(content, isComplete = false) {
  answerSection.classList.remove("hidden");
  if (isComplete) {
    answerContent.innerHTML = renderMarkdownSafe(content || "");
  } else {
    answerContent.textContent = content || "";
  }
  if (isComplete) {
    answerContent.scrollTop = 0;
  } else {
    answerContent.scrollTop = answerContent.scrollHeight;
  }
}
