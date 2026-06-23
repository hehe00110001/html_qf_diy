const DESIGN_WIDTH = 900;
const DESIGN_HEIGHT = 1100;
const COVER_RADIUS = Math.ceil(Math.hypot(DESIGN_WIDTH, DESIGN_HEIGHT) * 2);
const BOUNDS_PROBE_SCALE = 0.25;
const BOUNDS_PADDING = 18;

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.imageCache = new Map();
    this.patternCache = new Map();
    this.boundsCache = new Map();
    this.regionCache = new Map();
    this.renderVersion = 0;
    this.renderScale = 0;

    this.frame = document.createElement("canvas");
    this.frameCtx = this.frame.getContext("2d");
    this.setupResolution();
  }

  setupResolution() {
    const nextScale = getRenderScale();
    if (nextScale === this.renderScale && this.pixelWidth && this.pixelHeight) return false;
    this.renderScale = nextScale;
    this.pixelWidth = Math.round(DESIGN_WIDTH * this.renderScale);
    this.pixelHeight = Math.round(DESIGN_HEIGHT * this.renderScale);
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;
    this.canvas.dataset.designWidth = String(DESIGN_WIDTH);
    this.canvas.dataset.designHeight = String(DESIGN_HEIGHT);
    this.frame.width = this.pixelWidth;
    this.frame.height = this.pixelHeight;
    this.regionCache.clear();
    this.invalidate();
    return true;
  }

  async loadImage(src) {
    if (!src) throw new Error("Missing image source");
    if (this.imageCache.has(src)) return this.imageCache.get(src);

    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = src.startsWith("data:") || src.startsWith("blob:") ? null : "anonymous";
    const promise = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    });
    image.src = src;
    this.imageCache.set(src, promise);
    try {
      const loaded = await promise;
      this.imageCache.set(src, loaded);
      return loaded;
    } catch (error) {
      this.imageCache.delete(src);
      throw error;
    }
  }

  async render({ garment, regionStates, fabrics, decals = [] }) {
    this.setupResolution();
    const version = ++this.renderVersion;
    this.clearFrame();

    if (!garment) {
      this.commitFrame(null);
      return;
    }

    const garmentKey = garment._key || garment.id;
    this.pruneRegionCache(garmentKey, garment);
    const lineart = await this.loadOptionalImage(garment.lineart);
    if (version !== this.renderVersion) return;
    this.commitFrame(lineart);

    const fabricsById = new Map(fabrics.map((fabric) => [fabric.id, fabric]));
    const decalsByRegion = groupDecalsByRegion(decals);

    for (const region of garment.regions) {
      if (version !== this.renderVersion) return;
      const regionState = regionStates[region.id];
      const fabric = fabricsById.get(regionState?.fabricId) || fabrics[0];
      if (!fabric || !regionState) continue;

      try {
        const cached = await this.getRegionLayer({
          garmentKey,
          region,
          regionState,
          fabric,
          decals: decalsByRegion.get(region.id) || [],
          version
        });
        if (version !== this.renderVersion) return;
        if (cached) this.frameCtx.drawImage(cached.canvas, cached.bounds.x * this.renderScale, cached.bounds.y * this.renderScale);
      } catch (error) {
        console.warn(`Skip region ${region.id}:`, error);
      }

      if (version !== this.renderVersion) return;
      this.commitFrame(lineart);
      await nextFrame();
    }
  }

  async loadOptionalImage(src) {
    try {
      return await this.loadImage(src);
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  clearFrame() {
    const ctx = this.frameCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.pixelWidth, this.pixelHeight);
  }

  commitFrame(lineart) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    ctx.drawImage(this.frame, 0, 0);
    if (lineart) ctx.drawImage(lineart, 0, 0, this.pixelWidth, this.pixelHeight);
  }

  async getRegionLayer({ garmentKey, region, regionState, fabric, decals, version }) {
    const bounds = await this.getMaskBounds(region.mask);
    if (version !== this.renderVersion) return null;
    const cacheKey = makeRegionCacheKey({ garmentKey, region, regionState, fabric, decals, bounds, renderScale: this.renderScale });
    const cacheId = `${garmentKey}:${region.id}`;
    const cached = this.regionCache.get(cacheId);
    if (cached?.key === cacheKey) return cached;

    const width = Math.max(1, Math.ceil(bounds.width * this.renderScale));
    const height = Math.max(1, Math.ceil(bounds.height * this.renderScale));
    const canvas = cached?.canvas || document.createElement("canvas");
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    await this.renderRegionLayer(ctx, bounds, region.mask, fabric.src, regionState.transform, decals, version);
    if (version !== this.renderVersion) return null;
    const entry = { key: cacheKey, canvas, bounds, srcs: collectRegionSrcs(fabric, decals) };
    this.regionCache.set(cacheId, entry);
    return entry;
  }

  async renderRegionLayer(ctx, bounds, maskSrc, fabricSrc, transform, decals, version) {
    const mask = await this.loadImage(maskSrc);
    const fabric = await this.loadImage(fabricSrc);
    if (version !== this.renderVersion) return;

    this.prepareLocalContext(ctx, bounds);
    this.drawFabricInDesignSpace(ctx, fabricSrc, fabric, transform);

    for (const decal of decals) {
      if (version !== this.renderVersion) return;
      await this.drawDecal(ctx, decal);
    }

    if (version !== this.renderVersion) return;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-in";
    this.setLocalDesignTransform(ctx, bounds);
    ctx.drawImage(mask, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  prepareLocalContext(ctx, bounds) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, Math.ceil(bounds.width * this.renderScale), Math.ceil(bounds.height * this.renderScale));
    this.setLocalDesignTransform(ctx, bounds);
  }

  setLocalDesignTransform(ctx, bounds) {
    ctx.setTransform(this.renderScale, 0, 0, this.renderScale, -bounds.x * this.renderScale, -bounds.y * this.renderScale);
  }

  drawFabricInDesignSpace(ctx, fabricSrc, fabric, transform) {
    ctx.save();
    ctx.translate(DESIGN_WIDTH / 2 + transform.offsetX, DESIGN_HEIGHT / 2 + transform.offsetY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale, transform.scale);
    this.drawRepeatedFabric(ctx, fabricSrc, fabric, transform.scale);
    ctx.restore();
  }

  drawRepeatedFabric(ctx, fabricSrc, fabric, scale) {
    let pattern = this.patternCache.get(fabricSrc);
    if (!pattern) {
      pattern = ctx.createPattern(fabric, "repeat");
      if (pattern) this.patternCache.set(fabricSrc, pattern);
    }

    const safeScale = Math.max(Math.abs(scale) || 1, 0.05);
    const radius = Math.ceil(COVER_RADIUS / safeScale) + Math.max(fabric.width || 1, fabric.height || 1) * 2;
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      return;
    }

    for (let x = -radius; x < radius; x += fabric.width) {
      for (let y = -radius; y < radius; y += fabric.height) ctx.drawImage(fabric, x, y);
    }
  }

  async drawDecal(ctx, decal) {
    const image = await this.loadImage(decal.src);
    const size = decal.size || 180;
    ctx.save();
    ctx.globalAlpha = Number.isFinite(decal.opacity) ? decal.opacity : 1;
    ctx.translate(DESIGN_WIDTH / 2 + (decal.offsetX || 0), DESIGN_HEIGHT / 2 + (decal.offsetY || 0));
    ctx.rotate(((decal.rotation || 0) * Math.PI) / 180);
    ctx.scale(decal.scale || 1, decal.scale || 1);
    const aspect = image.width && image.height ? image.width / image.height : 1;
    const width = aspect >= 1 ? size : size * aspect;
    const height = aspect >= 1 ? size / aspect : size;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  async getMaskBounds(maskSrc) {
    const cached = this.boundsCache.get(maskSrc);
    if (cached) return cached;
    const mask = await this.loadImage(maskSrc);
    const probe = document.createElement("canvas");
    probe.width = Math.ceil(DESIGN_WIDTH * BOUNDS_PROBE_SCALE);
    probe.height = Math.ceil(DESIGN_HEIGHT * BOUNDS_PROBE_SCALE);
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, probe.width, probe.height);
    ctx.drawImage(mask, 0, 0, probe.width, probe.height);
    const pixels = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let minX = probe.width, minY = probe.height, maxX = -1, maxY = -1;
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        if (pixels[(y * probe.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const bounds = maxX < 0 ? fullBounds() : padBounds({
      x: Math.floor(minX / BOUNDS_PROBE_SCALE),
      y: Math.floor(minY / BOUNDS_PROBE_SCALE),
      width: Math.ceil((maxX - minX + 1) / BOUNDS_PROBE_SCALE),
      height: Math.ceil((maxY - minY + 1) / BOUNDS_PROBE_SCALE)
    });
    this.boundsCache.set(maskSrc, bounds);
    return bounds;
  }

  pruneRegionCache(garmentKey, garment) {
    const activeIds = new Set(garment.regions.map((region) => `${garmentKey}:${region.id}`));
    for (const key of this.regionCache.keys()) if (!activeIds.has(key)) this.regionCache.delete(key);
  }

  clearFabricCache(src) {
    this.imageCache.delete(src);
    this.patternCache.delete(src);
    for (const [key, cached] of this.regionCache.entries()) if (cached.srcs?.has(src)) this.regionCache.delete(key);
  }

  clearRegionCache() {
    this.regionCache.clear();
    this.invalidate();
  }

  invalidate() {
    this.renderVersion += 1;
  }

  downloadPng(fileName = "fabric-design.png") {
    const link = document.createElement("a");
    link.download = fileName;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }
}

function getRenderScale() {
  if (window.matchMedia("(max-width: 420px)").matches) return 0.64;
  if (window.matchMedia("(max-width: 760px)").matches) return 0.72;
  return 1;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function groupDecalsByRegion(decals) {
  const map = new Map();
  for (const decal of decals) {
    const list = map.get(decal.regionId) || [];
    list.push(decal);
    map.set(decal.regionId, list);
  }
  return map;
}

function makeRegionCacheKey({ garmentKey, region, regionState, fabric, decals, bounds, renderScale }) {
  return JSON.stringify({
    garmentKey,
    regionId: region.id,
    mask: region.mask,
    bounds,
    renderScale,
    fabricId: fabric.id,
    fabricSrc: fabric.src,
    transform: compactTransform(regionState.transform),
    decals: decals.map(compactDecal)
  });
}

function compactTransform(transform) {
  return { x: round(transform.offsetX), y: round(transform.offsetY), s: round(transform.scale), r: round(transform.rotation) };
}

function compactDecal(decal) {
  return {
    id: decal.id,
    src: decal.src,
    x: round(decal.offsetX || 0),
    y: round(decal.offsetY || 0),
    s: round(decal.scale || 1),
    r: round(decal.rotation || 0),
    size: round(decal.size || 180),
    opacity: round(Number.isFinite(decal.opacity) ? decal.opacity : 1)
  };
}

function collectRegionSrcs(fabric, decals) {
  return new Set([fabric.src, ...decals.map((decal) => decal.src)]);
}

function padBounds(bounds) {
  const x = Math.max(0, bounds.x - BOUNDS_PADDING);
  const y = Math.max(0, bounds.y - BOUNDS_PADDING);
  const right = Math.min(DESIGN_WIDTH, bounds.x + bounds.width + BOUNDS_PADDING);
  const bottom = Math.min(DESIGN_HEIGHT, bounds.y + bounds.height + BOUNDS_PADDING);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function fullBounds() {
  return { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}
