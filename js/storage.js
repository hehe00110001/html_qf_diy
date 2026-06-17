const STATE_KEY = "fabricDesigner.state.v1";
const SCHEME_KEY = "fabricDesigner.schemes.v1";
const FABRIC_KEY = "fabricDesigner.customFabrics.v1";
const FABRIC_GROUP_KEY = "fabricDesigner.fabricGroups.v1";
const FABRIC_GROUP_MAP_KEY = "fabricDesigner.fabricGroupMap.v1";
const DB_NAME = "fabricDesigner.assets.v1";
const DB_VERSION = 1;
const ASSET_STORE = "assets";

export function loadState() {
  return readJson(STATE_KEY, null);
}

export function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function loadSchemes() {
  return readJson(SCHEME_KEY, []);
}

export function saveSchemes(schemes) {
  localStorage.setItem(SCHEME_KEY, JSON.stringify(schemes));
}

export function loadCustomFabrics() {
  return readJson(FABRIC_KEY, []);
}

export function saveCustomFabrics(fabrics) {
  localStorage.setItem(FABRIC_KEY, JSON.stringify(fabrics));
}

export function loadFabricGroups() {
  return readJson(FABRIC_GROUP_KEY, ["默认"]);
}

export function saveFabricGroups(groups) {
  localStorage.setItem(FABRIC_GROUP_KEY, JSON.stringify(groups));
}

export function loadFabricGroupMap() {
  return readJson(FABRIC_GROUP_MAP_KEY, {});
}

export function saveFabricGroupMap(groupMap) {
  localStorage.setItem(FABRIC_GROUP_MAP_KEY, JSON.stringify(groupMap));
}

export async function putAssetBlob(key, blob) {
  const db = await openAssetDb();
  return requestToPromise(db.transaction(ASSET_STORE, "readwrite").objectStore(ASSET_STORE).put(blob, key));
}

export async function getAssetBlob(key) {
  const db = await openAssetDb();
  return requestToPromise(db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(key));
}

export async function deleteAssetBlob(key) {
  const db = await openAssetDb();
  return requestToPromise(db.transaction(ASSET_STORE, "readwrite").objectStore(ASSET_STORE).delete(key));
}

function openAssetDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
