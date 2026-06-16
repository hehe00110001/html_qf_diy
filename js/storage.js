const STATE_KEY = "fabricDesigner.state.v1";
const SCHEME_KEY = "fabricDesigner.schemes.v1";
const FABRIC_KEY = "fabricDesigner.customFabrics.v1";

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

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
