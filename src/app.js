import { clamp, formatNumber, formatDuration, formatFrameStamp, fitContain } from "./utils.js";
import { isImageFile, releaseFrames, loadImageAsset, toFileEntries, deriveFolderLabel, sortEntries, collectDroppedFiles } from "./files.js";
import { buildAnalysis } from "./composite.js";

const FRAME_LIST_LIMIT = 180;

const state = {
  frames: [],
  currentIndex: 0,
  playing: false,
  rafId: 0,
  lastTick: 0,
  accumulator: 0,
  loading: false,
  exporting: false,
  activeView: "strip",
  stripReady: false,
  analysis: null,
  settings: {
    orientation: "horizontal",
    scale: 100,
    gap: 0,
    fps: 12,
    loop: true,
  },
  folderLabel: "未选择文件夹",
};

const elements = Object.fromEntries(["resetBtn","dropzone","pickFilesBtn","pickFolderBtn","folderInput","filesInput","sourceSummary","folderMetric","countMetric","scaleInput","gapInput","limitWarning","limitNote","autoFitBtn","outputSizeText","downloadBtn","statusBar","stripTab","playerTab","stripScaleLabel","stripPanel","stripShell","stripPreviewCanvas","stripEmpty","demoBtn","playerPanel","playerShell","playerCanvas","playerEmpty","fpsInput","loopToggle","durationText","prevBtn","playBtn","nextBtn","currentFrameText","frameSlider","currentTimeText","framesDetails","frameListChip","frameList","stripExportCanvas"].map(id => [id, document.getElementById(id)]));

const stripPreviewContext = elements.stripPreviewCanvas.getContext("2d");
const stripExportContext = elements.stripExportCanvas.getContext("2d");
const playerContext = elements.playerCanvas.getContext("2d");

function setStatus(message, tone = "neutral") {
  elements.statusBar.dataset.tone = tone;
  elements.statusBar.textContent = message;
}

function getOrientation() {
  const checked = document.querySelector('input[name="orientation"]:checked');
  return checked ? checked.value : "horizontal";
}

function readSettingsFromControls() {
  state.settings.orientation = getOrientation();
  state.settings.scale = sanitizeNumberInput(elements.scaleInput, 1, 200, 100);
  state.settings.gap = sanitizeNumberInput(elements.gapInput, 0, 300, 0);
  state.settings.fps = sanitizeNumberInput(elements.fpsInput, 1, 120, 12);
  state.settings.loop = elements.loopToggle.checked;
}

function sanitizeNumberInput(input, min, max, fallback) {
  let next = input.value.trim() === "" ? fallback : Number(input.value);
  if (!Number.isFinite(next)) {
    next = fallback;
  }
  next = clamp(Math.round(next), min, max);
  input.value = String(next);
  return next;
}

async function loadSequence(entries, sourceLabel) {
  if (state.loading || state.exporting) return;
  const imageEntries = sortEntries(entries.filter(entry => isImageFile(entry.file)));
  if (!imageEntries.length) { setStatus("没有找到图片，请选择 PNG、JPG 等图片文件。", "warning"); return; }
  stopPlayback();
  state.loading = true;
  setInteractiveEnabled();
  const loadedFrames = [];
  try {
    for (let index = 0; index < imageEntries.length; index++) {
      const entry = imageEntries[index];
      setStatus("正在载入 " + (index + 1) + " / " + imageEntries.length + " 帧…", "working");
      const asset = await loadImageAsset(entry.file);
      loadedFrames.push({id: "frame-" + index, name: entry.file.name, relativePath: entry.relativePath || entry.file.name, ...asset});
    }
    releaseFrames(state.frames);
    state.frames = loadedFrames;
    state.currentIndex = 0;
    state.folderLabel = deriveFolderLabel(imageEntries);
    setStatus("已载入 " + loadedFrames.length + " 帧，可以导出 PNG。", "success");
    renderFrameList();
    rebuildAll();
  } catch (error) {
    releaseFrames(loadedFrames);
    setStatus("载入失败：" + (error.message || "图片无法读取") + (state.frames.length ? "。已保留原有图片。" : "。请换一组图片重试。"), "danger");
  } finally {
    state.loading = false;
    elements.folderInput.value = "";
    elements.filesInput.value = "";
    setInteractiveEnabled();
  }
}

function setInteractiveEnabled() {
  const busy = state.loading || state.exporting;
  const ready = state.frames.length > 0 && !busy;
  for (const name of ["pickFolderBtn", "pickFilesBtn", "folderInput", "filesInput", "scaleInput", "gapInput", "fpsInput", "loopToggle", "demoBtn"]) elements[name].disabled = busy;
  for (const radio of document.querySelectorAll('input[name="orientation"]')) radio.disabled = busy;
  elements.resetBtn.disabled = !ready;
  for (const name of ["playBtn", "prevBtn", "nextBtn", "frameSlider"]) elements[name].disabled = !ready;
  elements.playBtn.textContent = state.playing ? "暂停" : "播放";
  elements.playBtn.setAttribute("aria-pressed", String(state.playing));
  elements.downloadBtn.disabled = !ready || !state.stripReady || state.analysis?.exceedsLimit;
  elements.downloadBtn.textContent = state.exporting ? "正在导出…" : "导出 PNG";
  elements.autoFitBtn.disabled = busy || !state.analysis?.exceedsLimit || !state.analysis?.recommendedScale;
  elements.dropzone.setAttribute("aria-busy", String(state.loading));
}

function updateTopMetrics() {
  elements.folderMetric.textContent = state.folderLabel;
  elements.countMetric.textContent = state.frames.length + " 帧 · 按文件名排序";
  elements.sourceSummary.hidden = !state.frames.length;
  elements.durationText.textContent = state.frames.length ? "时长 " + formatDuration(state.frames.length / state.settings.fps) : "—";
}

function updateOutputMeta() {
  const a = state.analysis;
  elements.outputSizeText.textContent = a ? formatNumber(a.width) + " × " + formatNumber(a.height) + " px" : "—";
  elements.limitWarning.hidden = !a?.exceedsLimit;
  elements.limitNote.textContent = a?.recommendedScale > 0 ? "图片过大，建议缩放到 " + a.recommendedScale + "% 后导出。" : "图片过大，请减少帧数或间距。";
}

function updateCurrentFrameMeta() {
  const total = state.frames.length;
  if (!total) {
    elements.currentFrameText.textContent = "第 0 / 0 帧";
    elements.currentTimeText.textContent = "00.00s";
    elements.frameSlider.max = "0";
    elements.frameSlider.value = "0";
    return;
  }

  const index = clamp(state.currentIndex, 0, total - 1);
  const frame = state.frames[index];
  const seconds = index / state.settings.fps;
  elements.currentFrameText.textContent = formatFrameStamp(index, total);
  elements.currentTimeText.textContent = seconds.toFixed(seconds >= 10 ? 1 : 2) + "s · " + frame.name;
}

function updateEmptyStates() {
  const hasFrames = state.frames.length > 0;
  document.querySelector(".controls").dataset.loaded = String(hasFrames);
  elements.stripShell.hidden = !hasFrames;
  elements.stripEmpty.hidden = hasFrames;
  elements.playerShell.hidden = !hasFrames;
  elements.playerEmpty.hidden = hasFrames;
  elements.framesDetails.hidden = !hasFrames;
  elements.frameListChip.textContent = hasFrames ? state.frames.length + " 帧" : "";
}

function clearVisibleCanvases() {
  elements.stripPreviewCanvas.width = 1;
  elements.stripPreviewCanvas.height = 1;
  elements.playerCanvas.width = 1;
  elements.playerCanvas.height = 1;
  elements.stripExportCanvas.width = 1;
  elements.stripExportCanvas.height = 1;
}

function renderStrip() {
  state.stripReady = !!state.analysis && !state.analysis.exceedsLimit;
  if (!state.analysis) { clearVisibleCanvases(); elements.stripScaleLabel.textContent = "—"; return; }
  renderStripPreview();
}

function renderStripPreview() {
  const a = state.analysis;
  if (!a || state.activeView !== "strip") return;
  const maxWidth = Math.max(1, elements.stripShell.clientWidth - 48);
  const maxHeight = Math.max(1, elements.stripShell.clientHeight - 48);
  const fit = fitContain(a.width, a.height, Math.min(1200, maxWidth), Math.min(560, maxHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = elements.stripPreviewCanvas;
  canvas.width = Math.max(1, Math.round(fit.width * dpr));
  canvas.height = Math.max(1, Math.round(fit.height * dpr));
  canvas.style.width = fit.width + "px"; canvas.style.height = fit.height + "px";
  stripPreviewContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  stripPreviewContext.clearRect(0, 0, fit.width, fit.height);
  const sx = fit.width / a.width, sy = fit.height / a.height;
  for (const p of a.positions) stripPreviewContext.drawImage(p.frame.source, p.x*sx, p.y*sy, p.width*sx, p.height*sy);
  elements.stripScaleLabel.textContent = "预览 " + (fit.scale * 100).toFixed(1) + "%";
}

function renderPlayerFrame() {
  if (!state.frames.length) return;
  if (state.activeView === "player") {
    const frame = state.frames[state.currentIndex];
    const a = state.analysis;
    const width = Math.max(1, elements.playerShell.clientWidth - 48);
    const height = Math.max(1, elements.playerShell.clientHeight - 48);
    const fit = fitContain(a.maxFrameWidth, a.maxFrameHeight, width, height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = elements.playerCanvas;
    canvas.width = Math.max(1, Math.round(fit.width*dpr)); canvas.height = Math.max(1, Math.round(fit.height*dpr));
    canvas.style.width = fit.width + "px"; canvas.style.height = fit.height + "px";
    playerContext.setTransform(dpr,0,0,dpr,0,0);
    playerContext.clearRect(0,0,fit.width,fit.height);
    const w = frame.width*fit.scale, h = frame.height*fit.scale;
    playerContext.drawImage(frame.source, (fit.width-w)/2, (fit.height-h)/2, w, h);
  }
  elements.frameSlider.max = String(state.frames.length-1);
  elements.frameSlider.value = String(state.currentIndex);
  updateCurrentFrameMeta();
}

function renderFrameList() {
  elements.frameList.innerHTML = "";

  if (!state.frames.length) {
    const empty = document.createElement("div");
    empty.className = "tail-note";
    empty.textContent = "还没有载入序列帧。";
    elements.frameList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  const visibleFrames = state.frames.slice(0, FRAME_LIST_LIMIT);

  for (let index = 0; index < visibleFrames.length; index += 1) {
    const frame = visibleFrames[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "frame-card" + (index === state.currentIndex ? " is-active" : "");
    button.dataset.index = String(index);

    const indexLabel = document.createElement("div");
    indexLabel.className = "frame-index";
    indexLabel.textContent = "#" + String(index + 1).padStart(3, "0");

    const name = document.createElement("strong");
    name.textContent = frame.name;

    const size = document.createElement("span");
    size.textContent = formatNumber(frame.width) + " × " + formatNumber(frame.height);

    const path = document.createElement("small");
    path.textContent = frame.relativePath;

    button.appendChild(indexLabel);
    button.appendChild(name);
    button.appendChild(size);
    button.appendChild(path);
    fragment.appendChild(button);
  }

  if (state.frames.length > FRAME_LIST_LIMIT) {
    const note = document.createElement("div");
    note.className = "tail-note";
    note.textContent =
      "当前共 " +
      formatNumber(state.frames.length) +
      " 帧，仅展示前 " +
      formatNumber(FRAME_LIST_LIMIT) +
      " 帧。实际导出和播放会使用全部帧。";
    fragment.appendChild(note);
  }

  elements.frameList.appendChild(fragment);
}

function rebuildAll() {
  readSettingsFromControls();
  state.analysis = buildAnalysis(state.frames, state.settings);
  updateTopMetrics(); updateOutputMeta(); updateCurrentFrameMeta(); updateEmptyStates();
  renderStrip(); renderPlayerFrame(); setInteractiveEnabled();
  if (state.analysis?.exceedsLimit) setStatus("当前图片过大。可以预览，请缩小后再导出。", "warning");
  else if (state.frames.length && elements.statusBar.dataset.tone === "warning") setStatus("尺寸已调整，可以导出 PNG。", "success");
}

function stopPlayback() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.playing = false;
  state.lastTick = 0;
  state.accumulator = 0;
  setInteractiveEnabled();
}

function advanceFrame(delta) {
  if (!state.frames.length) {
    return;
  }

  const total = state.frames.length;
  if (delta > 0) {
    if (state.currentIndex >= total - 1) {
      if (state.settings.loop) {
        state.currentIndex = 0;
      } else {
        stopPlayback();
        return;
      }
    } else {
      state.currentIndex += 1;
    }
  } else {
    if (state.currentIndex <= 0) {
      state.currentIndex = total - 1;
    } else {
      state.currentIndex -= 1;
    }
  }

  renderPlayerFrame();
  updateFrameSelection();
}

function playbackLoop(timestamp) {
  if (!state.playing) {
    return;
  }

  const frameDuration = 1000 / state.settings.fps;
  if (!state.lastTick) {
    state.lastTick = timestamp;
  }
  state.accumulator += Math.min(timestamp - state.lastTick, 250);
  state.lastTick = timestamp;

  while (state.accumulator >= frameDuration && state.playing) {
    state.accumulator -= frameDuration;
    const before = state.currentIndex;
    advanceFrame(1);
    if (!state.settings.loop && before === state.currentIndex && before === state.frames.length - 1) {
      break;
    }
  }

  if (state.playing) {
    state.rafId = requestAnimationFrame(playbackLoop);
  }
}

function startPlayback() {
  if (!state.frames.length || state.playing) {
    return;
  }
  if (!state.settings.loop && state.currentIndex === state.frames.length - 1) {
    state.currentIndex = 0;
    renderPlayerFrame();
    updateFrameSelection();
  }
  state.playing = true;
  state.lastTick = 0;
  state.accumulator = 0;
  setInteractiveEnabled();
  state.rafId = requestAnimationFrame(playbackLoop);
}

async function downloadStrip() {
  if (state.loading || state.exporting) return;
  rebuildAll();
  if (!state.stripReady || state.loading || state.exporting || state.analysis?.exceedsLimit) return;
  stopPlayback(); state.exporting = true; setInteractiveEnabled();
  setStatus("正在生成 PNG…", "working");
  try {
    // Yield so the busy state paints before allocating the full-resolution surface.
    await new Promise(resolve => setTimeout(resolve, 0));
    const a = state.analysis, canvas = elements.stripExportCanvas;
    canvas.width = a.width; canvas.height = a.height;
    stripExportContext.setTransform(1,0,0,1,0,0);
    stripExportContext.clearRect(0,0,a.width,a.height);
    for (const p of a.positions) stripExportContext.drawImage(p.frame.source,p.x,p.y,p.width,p.height);
    const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("内存不足，请降低缩放后重试。")), "image/png"));
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = buildExportName(); document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("PNG 已生成，已发起下载。", "success");
  } catch(error) { setStatus("导出失败：" + (error.message || "请降低缩放后重试。"), "danger"); }
  finally { elements.stripExportCanvas.width = 1; elements.stripExportCanvas.height = 1; state.exporting = false; setInteractiveEnabled(); }
}

function buildExportName() {
  const cleanedFolder = (state.folderLabel || "sequence-frame")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return [
    cleanedFolder,
    state.settings.orientation === "horizontal" ? "row" : "column",
    state.frames.length + "f",
    state.settings.scale + "pct",
    state.analysis.width + "x" + state.analysis.height,
  ].join("-") + ".png";
}

function clearAll() {
  stopPlayback();
  releaseFrames(state.frames);
  state.frames = [];
  state.currentIndex = 0;
  state.analysis = null;
  state.folderLabel = "未选择文件夹";
  state.stripReady = false;
  renderFrameList();
  clearVisibleCanvases();
  setStatus("已清空当前序列帧。", "neutral");
  rebuildAll();
}

function handleFrameSelection(index) {
  if (!Number.isFinite(index) || index < 0 || index >= state.frames.length) {
    return;
  }
  if (state.loading || state.exporting) return;
  stopPlayback();
  state.currentIndex = index;
  renderPlayerFrame();
  updateFrameSelection();
  setInteractiveEnabled();
}

async function handleDrop(event) {
  event.preventDefault();
  elements.dropzone.classList.remove("dragover");
  if (state.loading || state.exporting) return;
  const transfer = event.dataTransfer;
  if (!transfer) {
    return;
  }

  const items = Array.from(transfer.items || []);
  const entries = [];

  for (const item of items) {
    if (typeof item.webkitGetAsEntry === "function") {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        entries.push(...(await collectDroppedFiles(entry)));
      }
    }
  }

  if (entries.length) {
    await loadSequence(entries, "拖拽文件夹");
    return;
  }

  const fallbackFiles = Array.from(transfer.files || []);
  if (fallbackFiles.length) {
    await loadSequence(toFileEntries(fallbackFiles), "拖拽图片");
  }
}

function applySafeScale() {
  if (!state.analysis || !state.analysis.exceedsLimit || !state.analysis.recommendedScale) {
    return;
  }
  elements.scaleInput.value = String(state.analysis.recommendedScale);
  rebuildAll();
  setStatus("已自动调整到 " + state.analysis.recommendedScale + "%。", "success");
}

function bindEvents() {
  elements.pickFolderBtn.addEventListener("click", () => elements.folderInput.click());
  elements.pickFilesBtn.addEventListener("click", () => elements.filesInput.click());
  elements.demoBtn.addEventListener("click", loadDemo);
  elements.resetBtn.addEventListener("click", clearAll);
  elements.autoFitBtn.addEventListener("click", applySafeScale);
  elements.playBtn.addEventListener("click", () => state.playing ? stopPlayback() : startPlayback());
  elements.prevBtn.addEventListener("click", () => handleFrameSelection((state.currentIndex-1+state.frames.length)%state.frames.length));
  elements.nextBtn.addEventListener("click", () => handleFrameSelection((state.currentIndex+1)%state.frames.length));
  elements.downloadBtn.addEventListener("click", downloadStrip);
  for (const [name,label] of [["folderInput","文件夹"],["filesInput","图片"]]) elements[name].addEventListener("change", event => {
    const files = Array.from(event.target.files || []);
    if (files.length) loadSequence(toFileEntries(files), label);
  });
  for (const input of document.querySelectorAll('input[name="orientation"]')) input.addEventListener("change", rebuildAll);
  let settingsTimer;
  for (const input of [elements.scaleInput, elements.gapInput]) {
    input.addEventListener("input", () => {
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(() => {
        if (input.value !== "" && input.validity.valid) rebuildAll();
      }, 180);
    });
    input.addEventListener("change", () => { clearTimeout(settingsTimer); rebuildAll(); });
  }
  elements.fpsInput.addEventListener("change", () => { readSettingsFromControls(); updateTopMetrics(); updateCurrentFrameMeta(); });
  elements.loopToggle.addEventListener("change", () => { state.settings.loop = elements.loopToggle.checked; });
  elements.frameSlider.addEventListener("input", () => handleFrameSelection(Number(elements.frameSlider.value)));
  elements.frameList.addEventListener("click", event => { const button = event.target.closest(".frame-card"); if (button) { switchView("player"); handleFrameSelection(Number(button.dataset.index)); } });
  for (const name of ["dragenter","dragover"]) elements.dropzone.addEventListener(name,event => { event.preventDefault(); if (!state.loading && !state.exporting) elements.dropzone.classList.add("dragover"); });
  for (const name of ["dragleave","dragend"]) elements.dropzone.addEventListener(name,() => elements.dropzone.classList.remove("dragover"));
  elements.dropzone.addEventListener("drop", event => handleDrop(event).catch(error => setStatus("无法读取拖入的文件：" + error.message, "danger")));
  for (const view of ["strip","player"]) {
    const tab = elements[view+"Tab"];
    tab.addEventListener("click", () => switchView(view));
    tab.addEventListener("keydown", event => { if (["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "strip" : event.key === "End" ? "player" : view === "strip" ? "player" : "strip"; switchView(next); elements[next+"Tab"].focus(); } });
  }
  document.addEventListener("keydown", event => {
    if (state.activeView !== "player" || !state.frames.length || state.loading || state.exporting || event.target.closest("input,button,a,summary,[contenteditable]")) return;
    if (event.code === "Space") { event.preventDefault(); state.playing ? stopPlayback() : startPlayback(); }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); handleFrameSelection((state.currentIndex + (event.key === "ArrowRight" ? 1 : -1) + state.frames.length)%state.frames.length); }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlayback(); });
  new ResizeObserver(() => { renderStripPreview(); renderPlayerFrame(); }).observe(document.querySelector(".preview-workspace"));
}

function updateFrameSelection() {
  const previous = elements.frameList.querySelector(".is-active");
  previous?.classList.remove("is-active");
  previous?.removeAttribute("aria-current");
  const current = elements.frameList.querySelector('[data-index="' + state.currentIndex + '"]');
  current?.classList.add("is-active");
  current?.setAttribute("aria-current", "true");
}

function switchView(view) {
  if (view !== "player") stopPlayback();
  state.activeView = view;
  for (const name of ["strip","player"]) {
    const selected = name === view;
    elements[name+"Tab"].setAttribute("aria-selected", String(selected));
    elements[name+"Tab"].tabIndex = selected ? 0 : -1;
    elements[name+"Panel"].hidden = !selected;
  }
  elements.stripScaleLabel.hidden = view !== "strip";
  renderStripPreview(); renderPlayerFrame();
}

async function loadDemo() {
  if (state.loading || state.exporting) return;
  state.loading = true;
  setInteractiveEnabled();
  try {
    const files = [];
    for (let i=0; i<6; i++) {
      const canvas = document.createElement("canvas"); canvas.width=160; canvas.height=160;
      const ctx=canvas.getContext("2d"); ctx.fillStyle="#0b0d10";
      ctx.beginPath(); ctx.arc(80, 90-Math.sin(i/5*Math.PI)*42, 20, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle="#00646d"; ctx.fillRect(28,132,104,3);
      const blob=await new Promise(resolve => canvas.toBlob(resolve,"image/png"));
      if (!blob) throw new Error("浏览器无法生成示例图片，请直接导入本地图片。");
      files.push(new File([blob], "demo-"+(i+1)+".png", {type:"image/png"}));
    }
    state.loading = false;
    await loadSequence(toFileEntries(files), "示例");
  } catch (error) {
    setStatus(error.message, "danger");
  } finally {
    state.loading = false;
    setInteractiveEnabled();
  }
}

bindEvents();
rebuildAll();
