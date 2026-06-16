const STATE_KEY = "fabricDesigner.state.v1";
const SCHEME_KEY = "fabricDesigner.schemes.v1";
const FABRIC_KEY = "fabricDesigner.customFabrics.v1";
const FABRIC_GROUP_KEY = "fabricDesigner.fabricGroups.v1";
const FABRIC_GROUP_MAP_KEY = "fabricDesigner.fabricGroupMap.v1";

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

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
