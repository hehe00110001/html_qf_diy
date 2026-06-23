export const DEFAULT_TRANSFORM = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0
};

export function normalizeTransform(transform = {}) {
  return {
    offsetX: Number.isFinite(transform.offsetX) ? transform.offsetX : DEFAULT_TRANSFORM.offsetX,
    offsetY: Number.isFinite(transform.offsetY) ? transform.offsetY : DEFAULT_TRANSFORM.offsetY,
    scale: Number.isFinite(transform.scale) ? clamp(transform.scale, 0.25, 4) : DEFAULT_TRANSFORM.scale,
    rotation: Number.isFinite(transform.rotation) ? transform.rotation : DEFAULT_TRANSFORM.rotation
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function attachCanvasGestures(canvas, getTransform, setTransform) {
  let pointerId = null;
  let start = null;

  canvas.addEventListener("pointerdown", (event) => {
    pointerId = event.pointerId;
    canvas.setPointerCapture(pointerId);
    const current = getTransform();
    start = {
      x: event.clientX,
      y: event.clientY,
      offsetX: current.offsetX,
      offsetY: current.offsetY
    };
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== pointerId) return;
    const current = getTransform();
    const designWidth = Number(canvas.dataset.designWidth) || canvas.width;
    const ratio = designWidth / canvas.getBoundingClientRect().width;
    setTransform({
      ...current,
      offsetX: start.offsetX + (event.clientX - start.x) * ratio,
      offsetY: start.offsetY + (event.clientY - start.y) * ratio
    });
  });

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const current = getTransform();
    const nextScale = clamp(current.scale * (event.deltaY > 0 ? 0.94 : 1.06), 0.25, 4);
    setTransform({ ...current, scale: nextScale });
  }, { passive: false });

  function endDrag(event) {
    if (event.pointerId !== pointerId) return;
    start = null;
    pointerId = null;
  }
}
