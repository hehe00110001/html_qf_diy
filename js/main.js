import { CanvasRenderer } from "./canvas-render.js";
import { DEFAULT_TRANSFORM, attachCanvasGestures, normalizeTransform } from "./transforms.js";
import { deleteAssetBlob, getAssetBlob, loadCustomFabrics, loadFabricGroupMap, loadFabricGroups, loadSchemes, loadState, putAssetBlob, saveCustomFabrics, saveFabricGroupMap, saveFabricGroups, saveSchemes, saveState } from "./storage.js";
import { createDiyAdapter } from "./diy-wrapper.js";

const DEFAULT_GROUP = "默认";
const FABRICS = [
  { id: "write", name: "白色", src: "./assets/fabrics/write.svg", group: DEFAULT_GROUP }];
const PRESET_DECALS = [
  { id: "long", name: "龙", src: "./assets/decals/long.svg" }];

const els = {
  canvas: document.querySelector("#designCanvas"), garmentList: document.querySelector("#garmentList"), regionList: document.querySelector("#regionList"),
  fabricGroupTabs: document.querySelector("#fabricGroupTabs"), fabricList: document.querySelector("#fabricList"), fabricUpload: document.querySelector("#fabricUpload"),
  solidColorInput: document.querySelector("#solidColorInput"), addColorBtn: document.querySelector("#addColorBtn"), groupMenu: document.querySelector("#groupMenu"),
  decalList: document.querySelector("#decalList"), decalUpload: document.querySelector("#decalUpload"), deleteDecalBtn: document.querySelector("#deleteDecalBtn"),
  decalScaleInput: document.querySelector("#decalScaleInput"), decalRotationInput: document.querySelector("#decalRotationInput"), decalOffsetXInput: document.querySelector("#decalOffsetXInput"), decalOffsetYInput: document.querySelector("#decalOffsetYInput"),
  cropModal: document.querySelector("#cropModal"), cropCanvas: document.querySelector("#cropCanvas"), cropFileName: document.querySelector("#cropFileName"), cropConfirmBtn: document.querySelector("#cropConfirmBtn"), cropCancelBtn: document.querySelector("#cropCancelBtn"), cropSkipBtn: document.querySelector("#cropSkipBtn"),
  scaleInput: document.querySelector("#scaleInput"), rotationInput: document.querySelector("#rotationInput"), offsetXInput: document.querySelector("#offsetXInput"), offsetYInput: document.querySelector("#offsetYInput"), resetBtn: document.querySelector("#resetBtn"), downloadBtn: document.querySelector("#downloadBtn"), statusText: document.querySelector("#statusText"),
  schemeName: document.querySelector("#schemeName"), saveSchemeBtn: document.querySelector("#saveSchemeBtn"), schemeList: document.querySelector("#schemeList")
};

const renderer = new CanvasRenderer(els.canvas);
const diyAdapter = createDiyAdapter();
let garments = [];
let fabricGroups = ensureDefaultGroup(loadFabricGroups());
let activeFabricGroup = fabricGroups[0];
let fabricGroupMap = loadFabricGroupMap();
let customFabrics = loadCustomFabrics().map((fabric) => ({ ...fabric, custom: true, group: fabric.group || DEFAULT_GROUP }));
let objectUrls = new Map();
let presetFabrics = FABRICS.map((fabric) => ({ ...fabric, group: fabricGroupMap[fabric.id] || fabric.group || DEFAULT_GROUP }));
let fabrics = [...customFabrics, ...presetFabrics];
let schemes = loadSchemes();
let state = { garmentId: null, activeRegionId: null, regionStates: {}, decals: [], activeDecalId: null };
let drawQueued = false, drawRunning = false, needsRedraw = false;
let uploadQueue = [], cropSession = null, longPressTimer = null;

init();

async function init() {
  garments = (await fetch("./data/garments.json").then((response) => response.json())).map((garment, index) => ({ ...garment, _key: `${garment.id || "garment"}-${index}` }));
  await hydrateCustomFabricSources();
  state = mergeInitialState(loadState());
  renderGarmentList(); renderFabricGroups(); renderFabricList(); renderRegions(); renderDecals(); renderSchemes(); bindEvents();
  await draw();
  els.statusText.textContent = `${diyAdapter.engine} 已就绪，可右键/长按移动面料分组，也可添加贴图。`;
}

function mergeInitialState(saved) {
  const garment = garments.find((item) => item._key === saved?.garmentKey) || garments.find((item) => item.id === saved?.garmentId) || garments[0];
  const activeRegionId = garment.regions.some((region) => region.id === saved?.activeRegionId) ? saved.activeRegionId : garment.regions[0].id;
  const next = { garmentId: garment.id, garmentKey: garment._key, activeRegionId, regionStates: {}, decals: Array.isArray(saved?.decals) ? saved.decals : [], activeDecalId: saved?.activeDecalId || null };
  for (const item of garments) for (const region of item.regions) {
    const savedRegion = saved?.regionStates?.[region.id];
    const savedFabricExists = fabrics.some((fabric) => fabric.id === savedRegion?.fabricId);
    next.regionStates[region.id] = { fabricId: savedFabricExists ? savedRegion.fabricId : fabrics[0].id, transform: normalizeTransform(savedRegion?.transform || DEFAULT_TRANSFORM) };
  }
  if (!next.decals.some((decal) => decal.id === next.activeDecalId)) next.activeDecalId = next.decals[0]?.id || null;
  return next;
}


async function hydrateCustomFabricSources() {
  let changed = false;
  const hydrated = [];
  for (const fabric of customFabrics) {
    if (fabric.assetKey && !fabric.src) {
      const blob = await getAssetBlob(fabric.assetKey);
      if (!blob) {
        changed = true;
        continue;
      }
      const url = URL.createObjectURL(blob);
      objectUrls.set(fabric.assetKey, url);
      fabric.src = url;
    } else if (fabric.src?.startsWith("data:image/") && fabric.kind === "image") {
      const assetKey = `fabric-${fabric.id}`;
      const blob = dataUrlToBlob(fabric.src);
      await putAssetBlob(assetKey, blob);
      fabric.assetKey = assetKey;
      fabric.src = URL.createObjectURL(blob);
      objectUrls.set(assetKey, fabric.src);
      changed = true;
    }
    if (fabric.src) hydrated.push(fabric);
    else changed = true;
  }
  customFabrics = hydrated;
  if (changed) saveCustomFabrics(stripRuntimeFabricData(customFabrics));
  fabrics = [...customFabrics, ...presetFabrics];
}

function stripRuntimeFabricData(items) {
  return items.map(({ src, ...fabric }) => {
    if (!fabric.assetKey && src) return { ...fabric, src };
    return fabric;
  });
}

function revokeFabricUrl(fabric) {
  if (!fabric.assetKey) return;
  const url = objectUrls.get(fabric.assetKey);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(fabric.assetKey);
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function bindEvents() {
  attachCanvasGestures(els.canvas, getActiveTransform, setActiveTransform);
  els.scaleInput.addEventListener("input", () => patchActiveTransform({ scale: Number(els.scaleInput.value) }));
  els.rotationInput.addEventListener("input", () => patchActiveTransform({ rotation: Number(els.rotationInput.value) }));
  els.offsetXInput.addEventListener("input", () => patchActiveTransform({ offsetX: Number(els.offsetXInput.value) }));
  els.offsetYInput.addEventListener("input", () => patchActiveTransform({ offsetY: Number(els.offsetYInput.value) }));
  els.resetBtn.addEventListener("click", () => setActiveTransform({ ...DEFAULT_TRANSFORM }));
  els.downloadBtn.addEventListener("click", () => renderer.downloadPng(`${getActiveGarment().id}-fabric-design.png`));
  els.fabricUpload.addEventListener("change", handleFabricUpload); els.addColorBtn.addEventListener("click", addSolidColorFabric);
  els.decalUpload.addEventListener("change", handleDecalUpload); els.deleteDecalBtn.addEventListener("click", deleteActiveDecal);
  els.decalScaleInput.addEventListener("input", () => patchActiveDecal({ scale: Number(els.decalScaleInput.value) }));
  els.decalRotationInput.addEventListener("input", () => patchActiveDecal({ rotation: Number(els.decalRotationInput.value) }));
  els.decalOffsetXInput.addEventListener("input", () => patchActiveDecal({ offsetX: Number(els.decalOffsetXInput.value) }));
  els.decalOffsetYInput.addEventListener("input", () => patchActiveDecal({ offsetY: Number(els.decalOffsetYInput.value) }));
  els.cropConfirmBtn.addEventListener("click", confirmCrop); els.cropCancelBtn.addEventListener("click", cancelCropQueue); els.cropSkipBtn.addEventListener("click", skipCrop);
  document.addEventListener("click", () => els.groupMenu.classList.add("hidden"));
  attachCropGestures(); bindPanelToggles(); window.addEventListener("resize", handleViewportChange); els.saveSchemeBtn.addEventListener("click", saveCurrentScheme);
}



function handleViewportChange() {
  renderer.clearRegionCache();
  queueDraw();
}

function bindPanelToggles() {
  document.querySelectorAll(".panel-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.closest(".panel");
      const collapsed = panel.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
    });
  });
}

function getActiveGarment() { return garments.find((item) => item._key === state.garmentKey) || garments.find((item) => item.id === state.garmentId) || garments[0]; }
function getActiveRegion() { return getActiveGarment().regions.find((item) => item.id === state.activeRegionId) || getActiveGarment().regions[0]; }
function getActiveRegionState() { return state.regionStates[state.activeRegionId]; }
function getActiveTransform() { return getActiveRegionState().transform; }
function setActiveTransform(transform) { getActiveRegionState().transform = normalizeTransform(transform); syncControls(); persistAndDraw(); }
function patchActiveTransform(patch) { setActiveTransform({ ...getActiveTransform(), ...patch }); }
function setFabricForActiveRegion(fabricId) { getActiveRegionState().fabricId = fabricId; renderFabricList(); persistAndDraw(); }
function getActiveDecal() { return state.decals.find((decal) => decal.id === state.activeDecalId) || null; }
function patchActiveDecal(patch) { const decal = getActiveDecal(); if (!decal) return; Object.assign(decal, patch); syncDecalControls(); persistAndDraw(); }

function renderGarmentList() {
  els.garmentList.innerHTML = "";
  for (const garment of garments) {
    const button = document.createElement("button"); button.className = `tile${garment._key === state.garmentKey ? " active" : ""}`; button.type = "button"; button.innerHTML = `<img src="${garment.thumbnail}" alt=""><span>${garment.name}</span>`;
    button.addEventListener("click", () => switchGarment(garment));
    els.garmentList.append(button);
  }
}


function switchGarment(garment) {
  state.garmentId = garment.id;
  state.garmentKey = garment._key;
  state.activeRegionId = garment.regions[0].id;
  ensureRegionStates(garment);
  renderer.clearRegionCache();
  renderGarmentList();
  renderRegions();
  renderFabricList();
  syncDecalControls();
  persistAndDraw();
}

function ensureRegionStates(garment) {
  for (const region of garment.regions) {
    if (!state.regionStates[region.id]) {
      state.regionStates[region.id] = {
        fabricId: fabrics[0].id,
        transform: normalizeTransform(DEFAULT_TRANSFORM)
      };
    }
  }
}

function renderRegions() {
  els.regionList.innerHTML = "";
  for (const region of getActiveGarment().regions) {
    const button = document.createElement("button"); button.type = "button"; button.className = region.id === state.activeRegionId ? "active" : ""; button.textContent = region.name;
    button.addEventListener("click", () => { state.activeRegionId = region.id; renderRegions(); renderFabricList(); syncControls(); updateMeta(); saveState(state); });
    els.regionList.append(button);
  }
  syncControls();
}

function renderFabricGroups() {
  els.fabricGroupTabs.innerHTML = "";
  for (const group of fabricGroups) {
    const button = document.createElement("button"); button.type = "button"; button.className = group === activeFabricGroup ? "active" : ""; button.textContent = group;
    button.addEventListener("click", () => { activeFabricGroup = group; renderFabricGroups(); renderFabricList(); });
    els.fabricGroupTabs.append(button);
  }
}

function renderFabricList() {
  const activeFabricId = getActiveRegionState()?.fabricId;
  els.fabricList.innerHTML = "";
  for (const fabric of fabrics.filter((item) => (item.group || DEFAULT_GROUP) === activeFabricGroup)) {
    const button = document.createElement("button"); button.className = `fabric-card${fabric.id === activeFabricId ? " active" : ""}`; button.type = "button"; button.title = fabric.name; button.innerHTML = `<img src="${fabric.src}" alt=""><span>${fabric.name}</span>`;
    button.addEventListener("click", () => setFabricForActiveRegion(fabric.id));
    button.addEventListener("contextmenu", (event) => { event.preventDefault(); openGroupMenu(fabric, event.clientX, event.clientY); });
    button.addEventListener("pointerdown", (event) => { longPressTimer = setTimeout(() => openGroupMenu(fabric, event.clientX, event.clientY), 560); });
    button.addEventListener("pointerup", clearLongPress); button.addEventListener("pointerleave", clearLongPress); button.addEventListener("pointercancel", clearLongPress);
    if (fabric.custom) {
      const deleteBtn = document.createElement("button"); deleteBtn.className = "delete-fabric"; deleteBtn.type = "button"; deleteBtn.textContent = "×"; deleteBtn.title = "删除面料";
      deleteBtn.addEventListener("click", (event) => { event.stopPropagation(); deleteCustomFabric(fabric.id); }); button.append(deleteBtn);
    }
    els.fabricList.append(button);
  }
  updateMeta();
}

function clearLongPress() { if (longPressTimer) clearTimeout(longPressTimer); longPressTimer = null; }

function openGroupMenu(fabric, x, y) {
  clearLongPress(); els.groupMenu.innerHTML = "";
  for (const group of fabricGroups) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `移动到：${group}`;
    button.addEventListener("click", (event) => { event.stopPropagation(); moveFabricToGroup(fabric, group); els.groupMenu.classList.add("hidden"); }); els.groupMenu.append(button);
  }
  const createBtn = document.createElement("button"); createBtn.type = "button"; createBtn.textContent = "创建新组...";
  createBtn.addEventListener("click", (event) => { event.stopPropagation(); showCreateGroupForm(fabric); }); els.groupMenu.append(createBtn);
  els.groupMenu.style.left = `${Math.min(x, window.innerWidth - 230)}px`; els.groupMenu.style.top = `${Math.min(y, window.innerHeight - 240)}px`; els.groupMenu.classList.remove("hidden");
}

function showCreateGroupForm(fabric) {
  els.groupMenu.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 20;
  input.placeholder = "新分组名称";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.textContent = "确认创建";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  const submit = () => {
    const name = input.value.trim();
    if (!name) return;
    moveFabricToGroup(fabric, name);
    els.groupMenu.classList.add("hidden");
  };
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  confirmBtn.addEventListener("click", (event) => { event.stopPropagation(); submit(); });
  cancelBtn.addEventListener("click", (event) => { event.stopPropagation(); els.groupMenu.classList.add("hidden"); });
  els.groupMenu.append(input, confirmBtn, cancelBtn);
  input.focus();
}

function moveFabricToGroup(fabric, group) {
  if (!fabricGroups.includes(group)) { fabricGroups.push(group); saveFabricGroups(fabricGroups); }
  if (fabric.custom) {
    const target = customFabrics.find((item) => item.id === fabric.id);
    if (target) target.group = group;
    saveCustomFabrics(stripRuntimeFabricData(customFabrics));
  } else {
    fabricGroupMap[fabric.id] = group;
    saveFabricGroupMap(fabricGroupMap);
  }
  presetFabrics = FABRICS.map((item) => ({ ...item, group: fabricGroupMap[item.id] || item.group || DEFAULT_GROUP }));
  fabrics = [...customFabrics, ...presetFabrics]; activeFabricGroup = group; renderFabricGroups(); renderFabricList();
}

function renderDecals() {
  els.decalList.innerHTML = "";
  for (const decal of PRESET_DECALS) {
    const button = document.createElement("button"); button.className = "fabric-card"; button.type = "button"; button.innerHTML = `<img src="${decal.src}" alt=""><span>${decal.name}</span>`;
    button.addEventListener("click", () => addDecal(decal)); els.decalList.append(button);
  }
  syncDecalControls();
}

function addDecal(source) {
  const decal = { id: `decal-${Date.now()}-${Math.round(Math.random() * 10000)}`, name: source.name, src: source.src, regionId: state.activeRegionId, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, size: 180, opacity: 1 };
  state.decals.push(decal); state.activeDecalId = decal.id; syncDecalControls(); persistAndDraw();
}

function handleDecalUpload(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => addDecal({ name: file.name.replace(/\.[^.]+$/, ""), src: exportImage(image, 320) }); image.src = String(reader.result); }; reader.readAsDataURL(file);
}

function deleteActiveDecal() { const decal = getActiveDecal(); if (!decal) return; state.decals = state.decals.filter((item) => item.id !== decal.id); state.activeDecalId = state.decals[0]?.id || null; renderer.clearFabricCache(decal.src); syncDecalControls(); persistAndDraw(); }
function syncDecalControls() { const decal = getActiveDecal(); const disabled = !decal; for (const input of [els.decalScaleInput, els.decalRotationInput, els.decalOffsetXInput, els.decalOffsetYInput]) input.disabled = disabled; els.deleteDecalBtn.disabled = disabled; els.decalScaleInput.value = decal?.scale ?? 1; els.decalRotationInput.value = decal?.rotation ?? 0; els.decalOffsetXInput.value = decal?.offsetX ?? 0; els.decalOffsetYInput.value = decal?.offsetY ?? 0; }

function renderSchemes() {
  let compacted = false;
  schemes = schemes.map((scheme) => {
    if (!scheme.customFabrics?.some?.((fabric) => fabric.src?.startsWith?.("data:image/"))) return scheme;
    compacted = true;
    return { ...scheme, customFabrics: stripRuntimeFabricData(scheme.customFabrics) };
  });
  if (compacted) saveSchemes(schemes);
  els.schemeList.innerHTML = ""; if (!schemes.length) { const empty = document.createElement("p"); empty.textContent = "暂无已保存方案。"; els.schemeList.append(empty); return; }
  schemes.forEach((scheme, index) => { const row = document.createElement("div"); row.className = "scheme-item"; row.innerHTML = `<span>${scheme.name}</span>`;
    const loadBtn = document.createElement("button"); loadBtn.type = "button"; loadBtn.textContent = "载入"; loadBtn.addEventListener("click", () => { mergeSchemeFabrics(scheme.customFabrics || []); state = mergeInitialState(scheme.state); renderer.clearRegionCache(); renderGarmentList(); renderRegions(); renderFabricGroups(); renderFabricList(); syncDecalControls(); persistAndDraw(); });
    const deleteBtn = document.createElement("button"); deleteBtn.type = "button"; deleteBtn.textContent = "删除"; deleteBtn.addEventListener("click", () => { schemes.splice(index, 1); saveSchemes(schemes); renderSchemes(); }); row.append(loadBtn, deleteBtn); els.schemeList.append(row); });
}

function syncControls() { const t = getActiveTransform(); els.scaleInput.value = t.scale; els.rotationInput.value = t.rotation; els.offsetXInput.value = t.offsetX; els.offsetYInput.value = t.offsetY; updateMeta(); }
function updateMeta() { const garment = getActiveGarment(), region = getActiveRegion(), fabric = fabrics.find((item) => item.id === getActiveRegionState()?.fabricId); els.statusText.textContent = `${garment?.name || "-"} / ${region?.name || "-"} / ${fabric?.name || "-"}`; }
function saveCurrentScheme() { const name = els.schemeName.value.trim() || `方案 ${schemes.length + 1}`; schemes.unshift({ id: randomId(), name, state: cloneData(state), customFabrics: cloneData(stripRuntimeFabricData(customFabrics)), createdAt: new Date().toISOString() }); schemes = schemes.slice(0, 12); saveSchemes(schemes); els.schemeName.value = ""; renderSchemes(); }

function handleFabricUpload(event) { const files = [...(event.target.files || [])].filter((file) => file.type.startsWith("image/")); event.target.value = ""; if (!files.length) return; uploadQueue = files; openNextCrop(); }
function addSolidColorFabric() { const color = els.solidColorInput.value || "#2f7d4a"; addCustomFabric({ id: `color-${Date.now()}`, name: `纯色 ${color.toUpperCase()}`, src: makeSolidColorSvg(color), custom: true, kind: "color", group: activeFabricGroup }); }
function addCustomFabric(fabric) { customFabrics = [{ ...fabric, custom: true, group: fabric.group || activeFabricGroup }, ...customFabrics].slice(0, 60); saveCustomFabrics(stripRuntimeFabricData(customFabrics)); fabrics = [...customFabrics, ...presetFabrics]; setFabricForActiveRegion(customFabrics[0].id); renderFabricList(); }
async function deleteCustomFabric(fabricId) { const removed = customFabrics.find((fabric) => fabric.id === fabricId); customFabrics = customFabrics.filter((fabric) => fabric.id !== fabricId); saveCustomFabrics(stripRuntimeFabricData(customFabrics)); fabrics = [...customFabrics, ...presetFabrics]; if (removed) { renderer.clearFabricCache(removed.src); revokeFabricUrl(removed); if (removed.assetKey) await deleteAssetBlob(removed.assetKey); } for (const regionState of Object.values(state.regionStates)) if (regionState.fabricId === fabricId) regionState.fabricId = fabrics[0].id; renderFabricList(); persistAndDraw(); }

function openNextCrop() { const file = uploadQueue.shift(); if (!file) { cropSession = null; els.cropModal.classList.add("hidden"); return; } const image = new Image(); const objectUrl = URL.createObjectURL(file); image.onload = () => { URL.revokeObjectURL(objectUrl); cropSession = createCropSession(file, image); els.cropFileName.textContent = file.name; els.cropModal.classList.remove("hidden"); drawCropCanvas(); }; image.src = objectUrl; }
function createCropSession(file, image) { const imageAspect = image.width / image.height, canvasAspect = els.cropCanvas.width / els.cropCanvas.height; let drawW = els.cropCanvas.width, drawH = els.cropCanvas.height; if (imageAspect > canvasAspect) drawH = drawW / imageAspect; else drawW = drawH * imageAspect; const drawX = (els.cropCanvas.width - drawW) / 2, drawY = (els.cropCanvas.height - drawH) / 2, side = Math.min(drawW, drawH) * 0.62; return { file, image, imageRect: { x: drawX, y: drawY, width: drawW, height: drawH }, crop: { x: drawX + (drawW - side) / 2, y: drawY + (drawH - side) / 2, width: side, height: side }, drag: null }; }
function drawCropCanvas() { if (!cropSession) return; const ctx = els.cropCanvas.getContext("2d"), { image, imageRect, crop } = cropSession; ctx.clearRect(0, 0, els.cropCanvas.width, els.cropCanvas.height); ctx.fillStyle = "#252b2d"; ctx.fillRect(0, 0, els.cropCanvas.width, els.cropCanvas.height); ctx.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height); ctx.fillStyle = "rgba(0, 0, 0, 0.48)"; ctx.fillRect(0, 0, els.cropCanvas.width, els.cropCanvas.height); ctx.save(); ctx.beginPath(); ctx.rect(crop.x, crop.y, crop.width, crop.height); ctx.clip(); ctx.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height); ctx.restore(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.strokeRect(crop.x, crop.y, crop.width, crop.height); ctx.fillStyle = "#ffffff"; for (const h of getCropHandles(crop)) ctx.fillRect(h.x - 5, h.y - 5, 10, 10); }
function attachCropGestures() { let pointerId = null; els.cropCanvas.addEventListener("pointerdown", (event) => { if (!cropSession) return; pointerId = event.pointerId; els.cropCanvas.setPointerCapture(pointerId); const point = getCropPoint(event); cropSession.drag = { mode: pickCropHandle(point, cropSession.crop), start: point, crop: { ...cropSession.crop } }; }); els.cropCanvas.addEventListener("pointermove", (event) => { if (!cropSession?.drag || event.pointerId !== pointerId) return; updateCrop(getCropPoint(event)); drawCropCanvas(); }); els.cropCanvas.addEventListener("pointerup", endCropDrag); els.cropCanvas.addEventListener("pointercancel", endCropDrag); function endCropDrag(event) { if (event.pointerId !== pointerId || !cropSession) return; cropSession.drag = null; pointerId = null; } }
function getCropPoint(event) { const rect = els.cropCanvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (els.cropCanvas.width / rect.width), y: (event.clientY - rect.top) * (els.cropCanvas.height / rect.height) }; }
function pickCropHandle(point, crop) { for (const h of getCropHandles(crop)) if (Math.abs(point.x - h.x) <= 18 && Math.abs(point.y - h.y) <= 18) return h.name; return "move"; }
function getCropHandles(crop) { return [{ name: "nw", x: crop.x, y: crop.y }, { name: "ne", x: crop.x + crop.width, y: crop.y }, { name: "sw", x: crop.x, y: crop.y + crop.height }, { name: "se", x: crop.x + crop.width, y: crop.y + crop.height }]; }
function updateCrop(point) { const { drag, imageRect } = cropSession, dx = point.x - drag.start.x, dy = point.y - drag.start.y; let crop = { ...drag.crop }; if (drag.mode === "move") { crop.x += dx; crop.y += dy; } else { if (drag.mode.includes("w")) { crop.x += dx; crop.width -= dx; } if (drag.mode.includes("e")) crop.width += dx; if (drag.mode.includes("n")) { crop.y += dy; crop.height -= dy; } if (drag.mode.includes("s")) crop.height += dy; } cropSession.crop = constrainCrop(crop, imageRect); }
function constrainCrop(crop, bounds) { const minSize = 40; if (crop.width < minSize) crop.width = minSize; if (crop.height < minSize) crop.height = minSize; crop.x = Math.min(Math.max(crop.x, bounds.x), bounds.x + bounds.width - crop.width); crop.y = Math.min(Math.max(crop.y, bounds.y), bounds.y + bounds.height - crop.height); crop.width = Math.min(crop.width, bounds.x + bounds.width - crop.x); crop.height = Math.min(crop.height, bounds.y + bounds.height - crop.y); return crop; }
async function confirmCrop() { if (!cropSession) return; const { image, imageRect, crop, file } = cropSession; const source = { x: ((crop.x - imageRect.x) / imageRect.width) * image.width, y: ((crop.y - imageRect.y) / imageRect.height) * image.height, width: (crop.width / imageRect.width) * image.width, height: (crop.height / imageRect.height) * image.height }; const id = `upload-${Date.now()}-${Math.round(Math.random() * 10000)}`; const assetKey = `fabric-${id}`; const blob = await exportCroppedBlob(image, source); await putAssetBlob(assetKey, blob); const src = URL.createObjectURL(blob); objectUrls.set(assetKey, src); addCustomFabric({ id, name: file.name.replace(/\.[^.]+$/, ""), src, assetKey, custom: true, kind: "image", group: activeFabricGroup }); openNextCrop(); }
async function exportCroppedBlob(image, source) { const maxSize = 512, scale = Math.min(1, maxSize / Math.max(source.width, source.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(64, Math.round(source.width * scale)); canvas.height = Math.max(64, Math.round(source.height * scale)); const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height); return canvasToBlob(canvas, "image/webp", 0.78); }
function canvasToBlob(canvas, type, quality) { return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality)); }
function exportImage(image, maxSize) { const scale = Math.min(1, maxSize / Math.max(image.width, image.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(64, Math.round(image.width * scale)); canvas.height = Math.max(64, Math.round(image.height * scale)); canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL("image/webp", 0.72); }
function skipCrop() { openNextCrop(); }
function cancelCropQueue() { uploadQueue = []; cropSession = null; els.cropModal.classList.add("hidden"); }
function makeSolidColorSvg(color) { return makeSvgData(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="${color}"/></svg>`); }
function makeSvgData(svg) { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
function cloneData(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function randomId() { return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()); }
function mergeSchemeFabrics(nextCustomFabrics) { const byId = new Map(customFabrics.map((fabric) => [fabric.id, { ...fabric, custom: true, group: fabric.group || DEFAULT_GROUP }])); for (const fabric of nextCustomFabrics) byId.set(fabric.id, { ...fabric, custom: true, group: fabric.group || DEFAULT_GROUP }); customFabrics = [...byId.values()].slice(0, 60); saveCustomFabrics(stripRuntimeFabricData(customFabrics)); fabrics = [...customFabrics, ...presetFabrics]; }
function ensureDefaultGroup(groups) { const clean = Array.isArray(groups) ? groups.filter(Boolean) : []; return clean.includes(DEFAULT_GROUP) ? clean : [DEFAULT_GROUP, ...clean]; }
function persistAndDraw() { saveState(state); queueDraw(); }
function queueDraw() { needsRedraw = true; if (drawRunning || drawQueued) return; drawQueued = true; requestAnimationFrame(processDrawQueue); }
async function processDrawQueue() { drawQueued = false; if (drawRunning) return; drawRunning = true; try { while (needsRedraw) { needsRedraw = false; await draw(); } } catch (error) { console.error(error); } finally { drawRunning = false; if (needsRedraw) queueDraw(); } }
async function draw() { syncControls(); syncDecalControls(); await renderer.render({ garment: getActiveGarment(), regionStates: state.regionStates, fabrics, decals: state.decals }); }
