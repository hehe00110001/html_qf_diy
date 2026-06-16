import { CanvasRenderer } from "./canvas-render.js";
import { DEFAULT_TRANSFORM, attachCanvasGestures, normalizeTransform } from "./transforms.js";
import { loadCustomFabrics, loadSchemes, loadState, saveCustomFabrics, saveSchemes, saveState } from "./storage.js";
import { createDiyAdapter } from "./diy-wrapper.js";

const FABRICS = [
  { id: "stripe", name: "海军条纹", src: "./assets/fabrics/stripe.svg" },
  { id: "dots", name: "圆点", src: "./assets/fabrics/dots.svg" },
  { id: "gingham", name: "格纹", src: "./assets/fabrics/gingham.svg" },
  { id: "floral", name: "花纹", src: "./assets/fabrics/floral.svg" },
  { id: "denim", name: "牛仔", src: "./assets/fabrics/denim.svg" },
  { id: "plain", name: "暖灰纯色", src: "./assets/fabrics/plain.svg" }
];

const els = {
  canvas: document.querySelector("#designCanvas"),
  garmentList: document.querySelector("#garmentList"),
  regionList: document.querySelector("#regionList"),
  fabricList: document.querySelector("#fabricList"),
  fabricUpload: document.querySelector("#fabricUpload"),
  scaleInput: document.querySelector("#scaleInput"),
  rotationInput: document.querySelector("#rotationInput"),
  offsetXInput: document.querySelector("#offsetXInput"),
  offsetYInput: document.querySelector("#offsetYInput"),
  resetBtn: document.querySelector("#resetBtn"),
  downloadBtn: document.querySelector("#downloadBtn"),
  statusText: document.querySelector("#statusText"),
  metaGarment: document.querySelector("#metaGarment"),
  metaRegion: document.querySelector("#metaRegion"),
  metaFabric: document.querySelector("#metaFabric"),
  schemeName: document.querySelector("#schemeName"),
  saveSchemeBtn: document.querySelector("#saveSchemeBtn"),
  schemeList: document.querySelector("#schemeList")
};

const renderer = new CanvasRenderer(els.canvas);
const diyAdapter = createDiyAdapter();
let garments = [];
let customFabrics = loadCustomFabrics();
let fabrics = [...customFabrics, ...FABRICS];
let schemes = loadSchemes();
let state = {
  garmentId: null,
  activeRegionId: null,
  regionStates: {}
};
let drawQueued = false;
let drawRunning = false;
let needsRedraw = false;

init();

async function init() {
  garments = await fetch("./data/garments.json").then((response) => response.json());
  state = mergeInitialState(loadState());
  renderGarmentList();
  renderFabricList();
  renderRegions();
  renderSchemes();
  bindEvents();
  await draw();
  els.statusText.textContent = `${diyAdapter.engine} 已就绪，可拖拽、滚轮缩放并导出 PNG。`;
}

function mergeInitialState(saved) {
  const firstGarment = garments[0];
  const garment = garments.find((item) => item.id === saved?.garmentId) || firstGarment;
  const activeRegionId = garment.regions.some((region) => region.id === saved?.activeRegionId)
    ? saved.activeRegionId
    : garment.regions[0].id;
  const next = {
    garmentId: garment.id,
    activeRegionId,
    regionStates: {}
  };

  for (const item of garments) {
    for (const region of item.regions) {
      const savedRegion = saved?.regionStates?.[region.id];
      next.regionStates[region.id] = {
        fabricId: savedRegion?.fabricId || fabrics[0].id,
        transform: normalizeTransform(savedRegion?.transform || DEFAULT_TRANSFORM)
      };
    }
  }
  return next;
}

function bindEvents() {
  attachCanvasGestures(els.canvas, getActiveTransform, setActiveTransform);
  els.scaleInput.addEventListener("input", () => patchActiveTransform({ scale: Number(els.scaleInput.value) }));
  els.rotationInput.addEventListener("input", () => patchActiveTransform({ rotation: Number(els.rotationInput.value) }));
  els.offsetXInput.addEventListener("input", () => patchActiveTransform({ offsetX: Number(els.offsetXInput.value) }));
  els.offsetYInput.addEventListener("input", () => patchActiveTransform({ offsetY: Number(els.offsetYInput.value) }));
  els.resetBtn.addEventListener("click", () => setActiveTransform({ ...DEFAULT_TRANSFORM }));
  els.downloadBtn.addEventListener("click", () => renderer.downloadPng(`${getActiveGarment().id}-fabric-design.png`));
  els.fabricUpload.addEventListener("change", handleFabricUpload);
  els.saveSchemeBtn.addEventListener("click", saveCurrentScheme);
}

function getActiveGarment() {
  return garments.find((item) => item.id === state.garmentId) || garments[0];
}

function getActiveRegion() {
  return getActiveGarment().regions.find((item) => item.id === state.activeRegionId) || getActiveGarment().regions[0];
}

function getActiveRegionState() {
  return state.regionStates[state.activeRegionId];
}

function getActiveTransform() {
  return getActiveRegionState().transform;
}

function setActiveTransform(transform) {
  getActiveRegionState().transform = normalizeTransform(transform);
  syncControls();
  persistAndDraw();
}

function patchActiveTransform(patch) {
  setActiveTransform({ ...getActiveTransform(), ...patch });
}

function setFabricForActiveRegion(fabricId) {
  getActiveRegionState().fabricId = fabricId;
  renderFabricList();
  persistAndDraw();
}

function renderGarmentList() {
  els.garmentList.innerHTML = "";
  for (const garment of garments) {
    const button = document.createElement("button");
    button.className = `tile${garment.id === state.garmentId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<img src="${garment.thumbnail}" alt=""><span>${garment.name}</span>`;
    button.addEventListener("click", () => {
      state.garmentId = garment.id;
      state.activeRegionId = garment.regions[0].id;
      renderGarmentList();
      renderRegions();
      persistAndDraw();
    });
    els.garmentList.append(button);
  }
}

function renderRegions() {
  const garment = getActiveGarment();
  els.regionList.innerHTML = "";
  for (const region of garment.regions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = region.id === state.activeRegionId ? "active" : "";
    button.textContent = region.name;
    button.addEventListener("click", () => {
      state.activeRegionId = region.id;
      renderRegions();
      renderFabricList();
      syncControls();
      updateMeta();
      saveState(state);
    });
    els.regionList.append(button);
  }
  syncControls();
}

function renderFabricList() {
  const activeFabricId = getActiveRegionState()?.fabricId;
  els.fabricList.innerHTML = "";
  for (const fabric of fabrics) {
    const button = document.createElement("button");
    button.className = `fabric-card${fabric.id === activeFabricId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<img src="${fabric.src}" alt=""><span>${fabric.name}</span>`;
    button.addEventListener("click", () => setFabricForActiveRegion(fabric.id));
    els.fabricList.append(button);
  }
  updateMeta();
}

function renderSchemes() {
  els.schemeList.innerHTML = "";
  if (!schemes.length) {
    const empty = document.createElement("p");
    empty.textContent = "暂无已保存方案。";
    els.schemeList.append(empty);
    return;
  }
  schemes.forEach((scheme, index) => {
    const row = document.createElement("div");
    row.className = "scheme-item";
    row.innerHTML = `<span>${scheme.name}</span>`;
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "载入";
    loadBtn.addEventListener("click", () => {
      mergeSchemeFabrics(scheme.customFabrics || []);
      state = mergeInitialState(scheme.state);
      renderGarmentList();
      renderRegions();
      renderFabricList();
      persistAndDraw();
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => {
      schemes.splice(index, 1);
      saveSchemes(schemes);
      renderSchemes();
    });
    row.append(loadBtn, deleteBtn);
    els.schemeList.append(row);
  });
}

function syncControls() {
  const transform = getActiveTransform();
  els.scaleInput.value = transform.scale;
  els.rotationInput.value = transform.rotation;
  els.offsetXInput.value = transform.offsetX;
  els.offsetYInput.value = transform.offsetY;
  updateMeta();
}

function updateMeta() {
  const garment = getActiveGarment();
  const region = getActiveRegion();
  const fabric = fabrics.find((item) => item.id === getActiveRegionState()?.fabricId);
  els.metaGarment.textContent = garment?.name || "-";
  els.metaRegion.textContent = region?.name || "-";
  els.metaFabric.textContent = fabric?.name || "-";
}

function saveCurrentScheme() {
  const name = els.schemeName.value.trim() || `方案 ${schemes.length + 1}`;
  schemes.unshift({
    id: randomId(),
    name,
    state: cloneData(state),
    customFabrics: cloneData(customFabrics),
    createdAt: new Date().toISOString()
  });
  schemes = schemes.slice(0, 12);
  saveSchemes(schemes);
  els.schemeName.value = "";
  renderSchemes();
}

function handleFabricUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const fabric = {
      id: `upload-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ""),
      src: String(reader.result)
    };
    customFabrics = [fabric, ...customFabrics].slice(0, 20);
    saveCustomFabrics(customFabrics);
    fabrics = [...customFabrics, ...FABRICS];
    setFabricForActiveRegion(fabric.id);
    event.target.value = "";
  };
  reader.readAsDataURL(file);
}

function cloneData(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function randomId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());
}

function mergeSchemeFabrics(nextCustomFabrics) {
  const byId = new Map(customFabrics.map((fabric) => [fabric.id, fabric]));
  for (const fabric of nextCustomFabrics) {
    byId.set(fabric.id, fabric);
  }
  customFabrics = [...byId.values()].slice(0, 20);
  saveCustomFabrics(customFabrics);
  fabrics = [...customFabrics, ...FABRICS];
}

function persistAndDraw() {
  saveState(state);
  queueDraw();
}

function queueDraw() {
  needsRedraw = true;
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(async () => {
    drawQueued = false;
    if (drawRunning) return;
    drawRunning = true;
    while (needsRedraw) {
      needsRedraw = false;
      await draw();
    }
    drawRunning = false;
  });
}

async function draw() {
  syncControls();
  await renderer.render({
    garment: getActiveGarment(),
    regionStates: state.regionStates,
    fabrics
  });
}
