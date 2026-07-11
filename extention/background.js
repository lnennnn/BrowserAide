

const Config = {
  SERVER_URL: "http://127.0.0.1:8004",
  MAX_STEPS: 20,
  MAX_LOGS: 50,

  LOAD_WAIT_DELAY: 200,
  MULTI_ACTION_DELAY: 50,


  SMART_WAIT_MAX: 300,
  SMART_WAIT_INTERVAL: 50,


  SCREENSHOT_QUALITY: 60,
  SCREENSHOT_RETRIES: 3,
  SCREENSHOT_RETRY_DELAY: 180,
  SCREENSHOT_MIN_INTERVAL: 550,
  SCREENSHOT_QUOTA_RETRY_DELAY: 1200,
  MAX_IMAGE_PIXELS: 1350 * 28 * 28,
  IMAGE_COMPRESS_ENABLED: true,


  USE_SSE_STREAMING: true,
  STEP_REQUEST_SCHEMA_VERSION: "agent.step.request.v1",
};

const DEFAULT_TASK_SETTINGS = {
  maxSteps: Config.MAX_STEPS,
  retryLimit: 3,
  pageWaitTime: 8000,
  apiKey: "",
  baseUrl: "",
  modelName: ""
};


const ControlMode = {
  DOM: "dom",
  VISUAL: "visual",
  HYBRID: "hybrid"
};


let agentState = {

  instruction: "",
  tabId: null,
  windowId: null,
  sessionId: null,


  isRunning: false,
  isPaused: false,
  pauseReason: "",


  step: 0,
  status: "Ready",
  backendAvailable: null,
  backendError: "",


  thought: "",
  action: "",
  finalAnswer: "",


  controlMode: ControlMode.HYBRID,


  taskSettings: { ...DEFAULT_TASK_SETTINGS },


  abortController: null,


  lastActionResult: null,


  logs: []              // [{level, message, timestamp}]
};

let lastScreenshotCaptureAt = 0;
let screenshotQuotaCooldownUntil = 0;

function generateSessionId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ext_${timestamp}_${random}`;
}

function resetState(newSession = true) {
  const savedMode = agentState.controlMode;


  if (agentState.abortController) {
    agentState.abortController.abort();
  }

  agentState = {
    instruction: "",
    tabId: null,
    windowId: null,
    sessionId: newSession ? generateSessionId() : agentState.sessionId,
    isRunning: false,
    isPaused: false,
    pauseReason: "",
    abortController: null,
    step: 0,
    status: "Ready",
    backendAvailable: agentState.backendAvailable,
    backendError: agentState.backendError,
    thought: "",
    action: "",
    finalAnswer: "",
    controlMode: savedMode,
    taskSettings: { ...DEFAULT_TASK_SETTINGS },
    lastActionResult: null,
    logs: []
  };
}

function parseIntegerSetting(value, fallback, min = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function normalizeTaskSettings(rawSettings = {}) {
  return {
    maxSteps: parseIntegerSetting(rawSettings.maxSteps, DEFAULT_TASK_SETTINGS.maxSteps, 1),
    retryLimit: parseIntegerSetting(rawSettings.retryLimit, DEFAULT_TASK_SETTINGS.retryLimit, 0),
    pageWaitTime: parseIntegerSetting(rawSettings.pageWaitTime, DEFAULT_TASK_SETTINGS.pageWaitTime, 0),
    apiKey: String(rawSettings.apiKey || "").trim(),
    baseUrl: String(rawSettings.baseUrl || "").trim(),
    modelName: String(rawSettings.modelName || "").trim()
  };
}

function addLog(level, message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  const logEntry = { level, message, timestamp };
  agentState.logs.push(logEntry);


  if (agentState.logs.length > Config.MAX_LOGS) {
    agentState.logs = agentState.logs.slice(-Config.MAX_LOGS);
  }


  chrome.runtime.sendMessage({
    type: "LOG_UPDATE",
    log: logEntry,
    totalLogs: agentState.logs.length
  }).catch(() => {

  });
}

function updateStatus(status) {
  agentState.status = status;
  console.log(`[Agent] ${status}`);
}


chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[Agent] sidePanel error:", error));


chrome.tabs.onActivated.addListener((activeInfo) => {
  if (agentState.isRunning && activeInfo.windowId === agentState.windowId) {
    console.log("[Agent] Tab focus changed to:", activeInfo.tabId);
    agentState.tabId = activeInfo.tabId;
  }
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    "START_TASK": () => {
      handleStartTask(message.instruction, message.settings);
      return { ok: true };
    },

    "STOP_TASK": () => {
      handleStopTask();
      return { ok: true };
    },

    "RESUME_TASK": () => {

      handleResumeTask(sendResponse);
      return null;
    },

    "GET_STATE": () => {
      return { ...agentState };
    },

    "CHECK_BACKEND": () => {
      handleCheckBackend({ silent: Boolean(message.silent) })
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return null;
    },

    "RESET_AGENT": () => {

      handleResetAgent()
        .then((res) => sendResponse({ ok: true, message: res.message }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return null;
    },

    "TEST_VLM_ENDPOINT": () => {
      handleTestVlmEndpoint(message.settings)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return null;
    },

    "CLEAR_LOGS": () => {
      agentState.logs = [];
      return { ok: true };
    },


    "GET_LOGS": () => {
      return { ok: true, logs: [...agentState.logs] };
    },


    "SET_MODE": () => {
      const mode = message.mode;
      if (Object.values(ControlMode).includes(mode)) {
        agentState.controlMode = mode;
        addLog("info", `🎛️ Control mode: ${mode}`);

        syncModeToServer(mode);
        return { ok: true, mode: mode };
      }
      return { ok: false, error: "Invalid mode" };
    },


    "GET_MODE": () => {
      return { ok: true, mode: agentState.controlMode };
    }
  };

  const handler = handlers[message.type];

  if (!handler) {
    sendResponse({ ok: false, error: "Unknown message type" });
    return;
  }

  const result = handler();

  if (result === null) {
    return true;
  }

  sendResponse(result);
});

async function syncModeToServer(mode) {
  try {
    await fetch(`${Config.SERVER_URL}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode })
    });
    console.log(`[Agent] Mode synced to server: ${mode}`);
  } catch (e) {
    console.warn("[Agent] Failed to sync mode to server:", e);
  }
}


async function handleStartTask(instruction, settings = {}) {

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    updateStatus("Error: No active tab");
    return;
  }


  const newSessionId = generateSessionId();


  agentState.instruction = instruction;
  agentState.isRunning = false;
  agentState.isPaused = false;
  agentState.pauseReason = "";
  agentState.tabId = tab.id;
  agentState.windowId = tab.windowId;
  agentState.sessionId = newSessionId;
  agentState.step = 0;
  agentState.thought = "";
  agentState.action = "";
  agentState.finalAnswer = "";
  agentState.logs = [];
  agentState.taskSettings = normalizeTaskSettings(settings);
  agentState.lastActionResult = null;

  updateStatus("Checking backend...");
  addLog("info", `Checking backend at ${Config.SERVER_URL}...`);

  try {
    await checkBackendConnection();
    agentState.backendAvailable = true;
    agentState.backendError = "";
  } catch (error) {
    const message = formatBackendUnavailableMessage(error);
    agentState.backendAvailable = false;
    agentState.backendError = message;
    updateStatus("❌ Backend unavailable");
    addLog("error", `❌ ${message}`);
    return;
  }

  agentState.isRunning = true;
  updateStatus("Starting...");
  addLog("info", `🚀 Task started: "${instruction}"`);


  runAgentLoop();
}

async function checkBackendConnection() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${Config.SERVER_URL}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Health check returned ${response.status}`);
    }

    return await response.json().catch(() => ({}));
  } finally {
    clearTimeout(timeout);
  }
}

async function handleCheckBackend({ silent = false } = {}) {
  if (!silent) {
    agentState.backendAvailable = null;
    agentState.backendError = "";
    if (!agentState.isRunning && !agentState.isPaused) {
      updateStatus("Checking backend...");
    }
  }

  try {
    const payload = await checkBackendConnection();
    agentState.backendAvailable = true;
    agentState.backendError = "";
    if (!agentState.isRunning && !agentState.isPaused) {
      updateStatus("Ready");
    }
    return { ok: true, payload };
  } catch (error) {
    const message = formatBackendUnavailableMessage(error);
    agentState.backendAvailable = false;
    agentState.backendError = message;
    if (!agentState.isRunning && !agentState.isPaused) {
      updateStatus("Offline");
    }
    return { ok: false, error: message };
  }
}

function isNetworkError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.name === "TypeError" ||
    error?.name === "AbortError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed");
}

function formatBackendUnavailableMessage(error) {
  const suffix = error?.name === "AbortError" ? "Request timed out." : (error?.message || "Failed to fetch.");
  return `Cannot connect to backend at ${Config.SERVER_URL}. ${suffix} Start it with: cd server && uvicorn main:app --host 127.0.0.1 --port 8004 --reload`;
}

function handleStopTask() {
  agentState.isRunning = false;
  agentState.isPaused = false;


  if (agentState.abortController) {
    agentState.abortController.abort();
    agentState.abortController = null;
  }

  updateStatus("Stopped by user");
  addLog("warn", "⏹️ Task stopped by user");
}

function handleResumeTask(sendResponse) {
  if (!agentState.isPaused) {
    sendResponse({ ok: false, error: "Agent is not paused" });
    return;
  }

  agentState.isPaused = false;
  agentState.pauseReason = "";
  updateStatus("Resuming...");
  addLog("info", "▶️ User completed action, resuming...");


  if (agentState.tabId) {
    chrome.tabs.sendMessage(agentState.tabId, { type: "HIDE_USER_NOTIFICATION" }).catch(() => {});
  }


  runAgentLoop();
  sendResponse({ ok: true });
}

async function handleResetAgent() {
  const oldSessionId = agentState.sessionId;
  resetState();

  try {

    const response = await fetch(`${Config.SERVER_URL}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: oldSessionId })
    });

    console.log(`[Agent] Session reset: ${oldSessionId} -> ${agentState.sessionId}`);
    return response.json();
  } catch (error) {
    throw new Error(formatBackendUnavailableMessage(error));
  }
}

async function handleTestVlmEndpoint(settings = {}) {
  const taskSettings = normalizeTaskSettings(settings);
  const response = await fetch(`${Config.SERVER_URL}/vlm/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: taskSettings.apiKey || null,
      base_url: taskSettings.baseUrl || null,
      model_name: taskSettings.modelName || null
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: payload.detail || payload.error || `Test failed (${response.status})` };
  }

  return payload;
}


function validateStepResponse(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Invalid step response: missing response object");
  }

  if (!Array.isArray(plan.actions)) {
    addLog("warn", "Step response did not include an actions array; using no-op action list");
    plan.actions = [];
  }

  plan.actions = plan.actions.filter((action) => {
    if (!action || typeof action !== "object") {
      addLog("warn", "Skipping invalid action object");
      return false;
    }
    if (!action.action_type) {
      addLog("warn", "Skipping action without action_type");
      return false;
    }
    if (!action.action_inputs || typeof action.action_inputs !== "object") {
      action.action_inputs = {};
    }
    return true;
  });

  if (typeof plan.action_summary !== "string") {
    plan.action_summary = plan.actions.map((action) => action.action_type).join(" → ");
  }

  return plan;
}


async function runAgentLoop() {
  const maxSteps = agentState.taskSettings?.maxSteps || Config.MAX_STEPS;

  while (agentState.isRunning && agentState.step < maxSteps) {
    try {
      agentState.step++;
      addLog("info", `━━━ Step ${agentState.step} ━━━`);

      // ======================== STEP 1: PERCEIVE ========================
      updateStatus(`Step ${agentState.step}: Perceiving...`);
      const perception = await perceive();


      if (!agentState.isRunning) {
        addLog("info", "🛑 Stopped by user");
        break;
      }


      if (!perception) {
        addLog("warn", "Waiting for page to load...");
        await sleep(Config.LOAD_WAIT_DELAY);
        agentState.step--;
        continue;
      }

      // ======================== STEP 2: PLAN ========================
      updateStatus(`Step ${agentState.step}: Planning...`);
      const plan = validateStepResponse(await planAction(perception));


      if (!agentState.isRunning) {
        addLog("info", "🛑 Stopped by user");
        break;
      }


      agentState.thought = plan.thought || "";
      agentState.action = plan.action_summary || "";

      if (plan.thought) addLog("thought", `💭 ${plan.thought}`);
      if (plan.action_summary) addLog("action", `🎯 ${plan.action_summary}`);


      if (plan.should_stop) {
        const answer = plan.final_answer || "Task completed";
        agentState.finalAnswer = answer;
        updateStatus(`✅ Task Completed`);
        agentState.isRunning = false;
        addLog("success", "🏁 Task completed");
        break;
      }

      // ======================== STEP 3: EXECUTE ========================
      updateStatus(`Step ${agentState.step}: Executing...`);
      const shouldPause = await executeActions(plan.actions, perception.viewport);


      if (!agentState.isRunning) {
        addLog("info", "🛑 Stopped by user");
        break;
      }


      if (shouldPause) {
        return;
      }


      updateStatus(`Step ${agentState.step}: Settling...`);
      await waitForPageStable(
        agentState.tabId,
        agentState.taskSettings?.pageWaitTime ?? Config.SMART_WAIT_MAX,
        Config.SMART_WAIT_INTERVAL
      );

    } catch (error) {

      if (error.name === 'AbortError' || !agentState.isRunning) {
        console.log("[Agent] Task aborted by user");
        addLog("info", "🛑 Stopped by user");
        break;
      }

      console.error("[Agent] Loop error:", error);

      if (isNetworkError(error)) {
        const message = formatBackendUnavailableMessage(error);
        updateStatus("❌ Backend unavailable");
        addLog("error", `❌ ${message}`);
        agentState.isRunning = false;
        break;
      }

      addLog("error", `❌ Error: ${error.message}`);

      updateStatus(`❌ Error: ${error.message}`);
      agentState.isRunning = false;
    }
  }


  if (agentState.step >= maxSteps && agentState.isRunning) {
    updateStatus(`⚠️ Reached maximum steps (${maxSteps})`);
    agentState.isRunning = false;
    addLog("warn", "Task stopped: Maximum steps reached");
  }
}


async function perceive() {
  const perceiveStart = performance.now();


  const [currentTab] = await chrome.tabs.query({
    active: true,
    windowId: agentState.windowId
  });
  if (currentTab) {
    agentState.tabId = currentTab.id;
  }


  if (!agentState.tabId) {
    console.error("[Agent] perceive: No valid tabId");
    return null;
  }

  const tab = await chrome.tabs.get(agentState.tabId);


  if (tab.status === "loading") {
    return null;
  }


  await ensureContentScript(agentState.tabId);


  const needDomElements = agentState.controlMode !== ControlMode.VISUAL;


  const tasks = [

    captureVisibleTabWithRetry(agentState.windowId),

    chrome.tabs.sendMessage(agentState.tabId, {
      type: "GET_PAGE_INFO"
    })
  ];


  if (needDomElements) {
    tasks.push(
      chrome.tabs.sendMessage(agentState.tabId, {
        type: "GET_DOM_ELEMENTS"
      }).catch(e => {
        console.warn("[Agent] Failed to get DOM elements:", e);
        return { elements: [] };
      })
    );
  }


  const results = await Promise.all(tasks);

  const rawScreenshot = results[0];
  const pageInfo = results[1];
  const domResult = needDomElements ? results[2] : null;
  const domElements = domResult?.elements || null;


  const compressStart = performance.now();
  const { dataUrl: compressedScreenshot, compressed, stats } = await compressScreenshot(rawScreenshot);
  const compressTime = (performance.now() - compressStart).toFixed(1);


  const perceiveTime = (performance.now() - perceiveStart).toFixed(1);


  const compressInfo = compressed ? ` [压缩: ${stats?.reduction}]` : '';
  if (needDomElements && domElements) {
    addLog("info", `📸 Screenshot + ${domElements.length} DOM${compressInfo} [${perceiveTime}ms]`);
  } else {
    addLog("info", `📸 Screenshot (${pageInfo.width}x${pageInfo.height})${compressInfo} [${perceiveTime}ms]`);
  }

  console.log(`[Perf] Perceive: ${perceiveTime}ms (parallel + compress: ${compressTime}ms)`);


  const result = {
    screenshot: compressedScreenshot.split(",")[1],
    viewport: {
      width: pageInfo.width,
      height: pageInfo.height
    },
    scroll: pageInfo.scroll,
    url: pageInfo.url,
    title: pageInfo.title,
    domElements: domElements
  };


  if (pageInfo.extractedText) {
    result.extractedText = pageInfo.extractedText;
    addLog("info", `📝 Page text extracted (${pageInfo.extractedText.length} chars)`);
  }

  return result;
}


async function captureVisibleTabWithRetry(windowId) {
  let lastError = null;

  for (let attempt = 1; attempt <= Config.SCREENSHOT_RETRIES; attempt++) {
    try {
      await waitForScreenshotQuota();
      return await chrome.tabs.captureVisibleTab(
        windowId,
        { format: "jpeg", quality: Config.SCREENSHOT_QUALITY }
      );
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      const quotaDelay = isScreenshotQuotaError(error)
        ? Config.SCREENSHOT_QUOTA_RETRY_DELAY
        : Config.SCREENSHOT_RETRY_DELAY * attempt;

      if (attempt < Config.SCREENSHOT_RETRIES) {
        console.warn(`[Agent] Screenshot capture failed (${attempt}/${Config.SCREENSHOT_RETRIES}): ${message}`);
        if (isScreenshotQuotaError(error)) {
          screenshotQuotaCooldownUntil = Date.now() + quotaDelay;
        }
        await sleep(quotaDelay);
        continue;
      }
    }
  }

  // PNG readback sometimes succeeds when JPEG readback fails on accelerated tabs.
  try {
    console.warn("[Agent] Retrying screenshot capture with PNG fallback");
    await waitForScreenshotQuota();
    return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (fallbackError) {
    throw new Error(`Failed to capture tab after retries: ${fallbackError?.message || lastError?.message || fallbackError}`);
  }
}

async function waitForScreenshotQuota() {
  const elapsed = Date.now() - lastScreenshotCaptureAt;
  const intervalWait = Config.SCREENSHOT_MIN_INTERVAL - elapsed;
  const cooldownWait = screenshotQuotaCooldownUntil - Date.now();
  const waitTime = Math.max(intervalWait, cooldownWait);
  if (waitTime > 0) {
    await sleep(waitTime);
  }
  lastScreenshotCaptureAt = Date.now();
}

function isScreenshotQuotaError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("max_capture_visible_tab_calls_per_second") ||
    message.includes("capture_visible_tab") && message.includes("quota");
}

async function compressScreenshot(dataUrl, maxPixels = Config.MAX_IMAGE_PIXELS, quality = Config.SCREENSHOT_QUALITY) {
  if (!Config.IMAGE_COMPRESS_ENABLED) {
    return { dataUrl, compressed: false, stats: null };
  }

  try {

    const response = await fetch(dataUrl);
    const originalBlob = await response.blob();


    const imageBitmap = await createImageBitmap(originalBlob);

    const originalWidth = imageBitmap.width;
    const originalHeight = imageBitmap.height;
    const originalPixels = originalWidth * originalHeight;

    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    let needsResize = false;


    if (originalPixels > maxPixels) {
      const scaleFactor = Math.sqrt(maxPixels / originalPixels);
      targetWidth = Math.floor(originalWidth * scaleFactor);
      targetHeight = Math.floor(originalHeight * scaleFactor);
      needsResize = true;
    }


    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');


    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);


    imageBitmap.close();


    const compressedBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: quality / 100
    });


    const compressedDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(compressedBlob);
    });


    const originalSize = Math.round(dataUrl.length * 0.75 / 1024);
    const compressedSize = Math.round(compressedDataUrl.length * 0.75 / 1024);

    const stats = {
      originalSize: `${originalSize}KB`,
      compressedSize: `${compressedSize}KB`,
      reduction: `${Math.round((1 - compressedSize / originalSize) * 100)}%`,
      originalDimensions: `${originalWidth}x${originalHeight}`,
      compressedDimensions: `${targetWidth}x${targetHeight}`,
      resized: needsResize
    };

    console.log(`[Perf] Image compress: ${stats.originalSize} → ${stats.compressedSize} (${stats.reduction}), ${stats.originalDimensions} → ${stats.compressedDimensions}`);

    return { dataUrl: compressedDataUrl, compressed: true, stats };

  } catch (err) {
    console.warn('[Agent] Image compression failed:', err);
    return { dataUrl, compressed: false, stats: { error: err.message } };
  }
}


async function planAction(perception) {
  if (Config.USE_SSE_STREAMING) {
    return await planActionStreaming(perception);
  } else {
    return await planActionNormal(perception);
  }
}

async function planActionNormal(perception) {
  const modeLabel = {
    [ControlMode.DOM]: "DOM",
    [ControlMode.VISUAL]: "Visual",
    [ControlMode.HYBRID]: "Hybrid"
  }[agentState.controlMode] || "Hybrid";

  addLog("info", `🧠 Calling VLM (${modeLabel} mode)...`);

  const requestBody = buildPlanRequestBody(perception);


  agentState.abortController = new AbortController();

  const response = await fetch(`${Config.SERVER_URL}/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: agentState.abortController.signal
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "VLM server error");
  }

  return await response.json();
}

async function planActionStreaming(perception) {
  const modeLabel = {
    [ControlMode.DOM]: "DOM",
    [ControlMode.VISUAL]: "Visual",
    [ControlMode.HYBRID]: "Hybrid"
  }[agentState.controlMode] || "Hybrid";

  addLog("info", `🧠 Calling VLM (${modeLabel} mode, streaming)...`);

  const requestBody = buildPlanRequestBody(perception);


  agentState.abortController = new AbortController();

  const response = await fetch(`${Config.SERVER_URL}/step/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: agentState.abortController.signal
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(err || "VLM server error");
  }


  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let result = null;
  let buffer = "";
  let lastThinkingContent = "";
  let ttftLogged = false;
  let currentEvent = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });


    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);

          switch (currentEvent) {
            case "first_token":
              if (!ttftLogged) {
                console.log(`[Perf] SSE TTFT: ${parsed.ttft_ms?.toFixed(1)}ms`);
                addLog("info", `⚡ First token received (TTFT: ${parsed.ttft_ms?.toFixed(0)}ms)`);
                ttftLogged = true;
              }
              break;

            case "thinking":

              lastThinkingContent = parsed.accumulated || "";
              agentState.thought = lastThinkingContent;


              chrome.runtime.sendMessage({
                type: "STREAMING_THOUGHT",
                content: lastThinkingContent,
                isComplete: false
              }).catch(() => {});
              break;

            case "action":

              addLog("action", `⚡ ${parsed.action_summary || "Action parsed"}`);
              updateStatus(`Step ${agentState.step}: Action parsed, finalizing...`);
              break;

            case "answer":

              updateStatus(`Step ${agentState.step}: Generating final answer...`);
              chrome.runtime.sendMessage({
                type: "STREAMING_ANSWER",
                content: parsed.accumulated || "",
                isComplete: false
              }).catch(() => {});
              break;

            case "complete":

              result = parsed;

              agentState.thought = parsed.thought || lastThinkingContent;
              if (parsed.final_answer) {
                agentState.finalAnswer = parsed.final_answer;
                chrome.runtime.sendMessage({
                  type: "STREAMING_ANSWER",
                  content: parsed.final_answer,
                  isComplete: true
                }).catch(() => {});
              }


              chrome.runtime.sendMessage({
                type: "STREAMING_THOUGHT",
                content: parsed.thought || lastThinkingContent,
                isComplete: true
              }).catch(() => {});

              if (parsed.metrics) {
                console.log(`[Perf] SSE Complete: TTFT=${parsed.metrics.vlm_ttft_ms?.toFixed(1)}ms, TTLT=${parsed.metrics.vlm_ttlt_ms?.toFixed(1)}ms, Total=${parsed.metrics.total_ms?.toFixed(1)}ms`);
                addLog("info", `✅ VLM complete (TTLT: ${parsed.metrics.vlm_ttlt_ms?.toFixed(0)}ms)`);
              }
              break;

            case "error":
              throw new Error(parsed.error || "Stream error");
          }
        } catch (e) {
          console.warn("[Agent] SSE parse error:", e, data);
          if (currentEvent === "error") throw e;
        }
        currentEvent = null;
      }
    }
  }

  if (!result) {
    throw new Error("SSE stream ended without complete event");
  }

  return result;
}

function buildPlanRequestBody(perception) {
  const requestBody = {
    schema_version: Config.STEP_REQUEST_SCHEMA_VERSION,
    instruction: agentState.instruction,
    screenshot: perception.screenshot,
    scroll_info: perception.scroll,
    width: perception.viewport.width,
    height: perception.viewport.height,
    control_mode: agentState.controlMode,
    session_id: agentState.sessionId,
    url: perception.url || "",
    title: perception.title || "",
    max_consecutive_failures: agentState.taskSettings?.retryLimit ?? DEFAULT_TASK_SETTINGS.retryLimit
  };

  if (agentState.taskSettings?.apiKey) {
    requestBody.api_key = agentState.taskSettings.apiKey;
  }

  if (agentState.taskSettings?.baseUrl) {
    requestBody.base_url = agentState.taskSettings.baseUrl;
  }

  if (agentState.taskSettings?.modelName) {
    requestBody.model_name = agentState.taskSettings.modelName;
  }

  if (agentState.controlMode !== ControlMode.VISUAL && perception.domElements) {
    requestBody.dom_elements = perception.domElements;
  }

  if (perception.extractedText) {
    requestBody.extracted_text = perception.extractedText;
  }

  if (agentState.lastActionResult) {
    requestBody.last_action_result = agentState.lastActionResult;
    agentState.lastActionResult = null;
  }

  return requestBody;
}


async function executeActions(actions, viewport) {
  if (!actions || actions.length === 0) {
    addLog("warn", "No actions to execute");
    agentState.lastActionResult = { success: true, error: null };
    return false;
  }

  let lastError = null;
  let allSuccess = true;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action?.action_type) {
      addLog("warn", "Skipping invalid action without action_type");
      allSuccess = false;
      lastError = "Invalid action without action_type";
      continue;
    }

    const actionType = action.action_type.toLowerCase();
    action.action_inputs = action.action_inputs || {};

    if (actionType === "finish" || actionType === "finished") {
      continue;
    }

    if (actionType === "call_user") {
      agentState.lastActionResult = { success: true, error: null };
      return await handleCallUser(action);
    }

    addLog("action", `⚡ Executing: ${actionType}`);

    try {
      await sendActionToContent(agentState.tabId, action, viewport);
    } catch (e) {
      addLog("warn", `Action warning: ${e.message}`);
      allSuccess = false;
      lastError = e.message;
    }

    if (i < actions.length - 1) {
      await sleep(Config.MULTI_ACTION_DELAY);
    }
  }

  agentState.lastActionResult = {
    success: allSuccess,
    error: lastError
  };

  return false;
}

async function sendActionToContent(tabId, action, viewport) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "EXECUTE_ACTION",
    action: action,
    viewport: viewport
  });

  if (!response?.ok) {
    throw new Error(response?.error || `Action failed: ${action.action_type}`);
  }

  return response;
}

async function handleCallUser(action) {
  const reason = action.action_inputs?.reason || "User action required";


  agentState.isPaused = true;
  agentState.pauseReason = reason;
  updateStatus(`⏸️ Waiting for user: ${reason}`);
  addLog("warn", `🙋 Call User: ${reason}`);


  try {
    await chrome.tabs.sendMessage(agentState.tabId, {
      type: "SHOW_USER_NOTIFICATION",
      reason: reason
    });
  } catch (e) {
    console.log("[V4] Could not show page notification");
  }

  return true;
}


async function ensureContentScript(tabId) {
  if (!tabId) {
    console.warn("[Agent] ensureContentScript: tabId is null/undefined");
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch (e) {

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
    await sleep(100);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function waitForPageStable(tabId, maxWait = Config.SMART_WAIT_MAX, checkInterval = Config.SMART_WAIT_INTERVAL) {
  if (!tabId) {
    console.warn("[Agent] waitForPageStable: tabId is null/undefined");
    return false;
  }

  const startTime = Date.now();
  let lastState = null;
  let stableCount = 0;
  const stableThreshold = 2;

  while (Date.now() - startTime < maxWait) {
    try {

      const state = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_STATE" });
      const stateStr = JSON.stringify(state);

      if (stateStr === lastState) {
        stableCount++;
        if (stableCount >= stableThreshold) {
          // console.log(`[Agent] Page stable after ${Date.now() - startTime}ms`);
          return true;
        }
      } else {
        stableCount = 0;
        lastState = stateStr;
      }
    } catch (e) {

    }

    await sleep(checkInterval);
  }

  // console.log(`[Agent] Page wait timeout (${maxWait}ms), proceeding anyway`);
  return false;
}


console.log("[Agent] Background service worker loaded - Three-Mode support enabled");
