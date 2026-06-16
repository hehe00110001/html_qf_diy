const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 1100;
const COVER_RADIUS = Math.ceil(Math.hypot(CANVAS_WIDTH, CANVAS_HEIGHT) * 2);

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.imageCache = new Map();
    this.patternCache = new Map();
    this.layer = document.createElement("canvas");
    this.layer.width = CANVAS_WIDTH;
    this.layer.height = CANVAS_HEIGHT;
    this.layerCtx = this.layer.getContext("2d");
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
  }

  async loadImage(src) {
    if (!src) return null;
    if (this.imageCache.has(src)) return this.imageCache.get(src);

    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = src.startsWith("data:") ? null : "anonymous";
    const promise = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
    });
    image.src = src;
    await promise;
    this.imageCache.set(src, image);
    return image;
  }

  async render({ garment, regionStates, fabrics, decals = [] }) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (!garment) return;

    for (const region of garment.regions) {
      const regionState = regionStates[region.id];
      const fabric = fabrics.find((item) => item.id === regionState?.fabricId) || fabrics[0];
      if (!fabric || !regionState) continue;
      await this.drawRegion(region.mask, fabric.src, regionState.transform, decals.filter((decal) => decal.regionId === region.id));
    }

    const lineart = await this.loadImage(garment.lineart);
    ctx.drawImage(lineart, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  async drawRegion(maskSrc, fabricSrc, transform, decals = []) {
    const ctx = this.ctx;
    const mask = await this.loadImage(maskSrc);
    const fabric = await this.loadImage(fabricSrc);
    const layerCtx = this.layerCtx;

    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.globalCompositeOperation = "source-over";
    layerCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    layerCtx.save();
    layerCtx.translate(CANVAS_WIDTH / 2 + transform.offsetX, CANVAS_HEIGHT / 2 + transform.offsetY);
    layerCtx.rotate((transform.rotation * Math.PI) / 180);
    layerCtx.scale(transform.scale, transform.scale);
    this.drawRepeatedFabric(layerCtx, fabricSrc, fabric, transform.scale);
    layerCtx.restore();

    for (const decal of decals) {
      await this.drawDecal(layerCtx, decal);
    }

    layerCtx.globalCompositeOperation = "destination-in";
    layerCtx.drawImage(mask, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    layerCtx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.layer, 0, 0);
  }

  drawRepeatedFabric(ctx, fabricSrc, fabric, scale) {
    let pattern = this.patternCache.get(fabricSrc);
    if (!pattern) {
      pattern = ctx.createPattern(fabric, "repeat");
      if (pattern) this.patternCache.set(fabricSrc, pattern);
    }

    const safeScale = Math.max(Math.abs(scale) || 1, 0.05);
    const radius = Math.ceil(COVER_RADIUS / safeScale) + Math.max(fabric.width, fabric.height) * 2;

    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      return;
    }

    for (let x = -radius; x < radius; x += fabric.width) {
      for (let y = -radius; y < radius; y += fabric.height) {
        ctx.drawImage(fabric, x, y);
      }
    }
  }

  async drawDecal(ctx, decal) {
    const image = await this.loadImage(decal.src);
    const size = decal.size || 180;
    ctx.save();
    ctx.globalAlpha = Number.isFinite(decal.opacity) ? decal.opacity : 1;
    ctx.translate(CANVAS_WIDTH / 2 + (decal.offsetX || 0), CANVAS_HEIGHT / 2 + (decal.offsetY || 0));
    ctx.rotate(((decal.rotation || 0) * Math.PI) / 180);
    ctx.scale(decal.scale || 1, decal.scale || 1);
    const aspect = image.width && image.height ? image.width / image.height : 1;
    const width = aspect >= 1 ? size : size * aspect;
    const height = aspect >= 1 ? size / aspect : size;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  clearFabricCache(src) {
    this.imageCache.delete(src);
    this.patternCache.delete(src);
  }

  downloadPng(fileName = "fabric-design.png") {
    const link = document.createElement("a");
    link.download = fileName;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }
}
