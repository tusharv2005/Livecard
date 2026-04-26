"use strict";
(() => {
  // src/shared/storage.ts
  var STORAGE_KEYS = {
    gifUrl: "livecardGifUrl",
    xPos: "livecardGifPosX",
    yPos: "livecardGifPosY",
    zoom: "livecardGifZoom"
  };
  var DEFAULT_SETTINGS = {
    gifUrl: "",
    xPos: 50,
    yPos: 50,
    zoom: 1
  };
  function sanitizeSettings(raw) {
    const xPos = Number.isFinite(raw.xPos) ? Number(raw.xPos) : DEFAULT_SETTINGS.xPos;
    const yPos = Number.isFinite(raw.yPos) ? Number(raw.yPos) : DEFAULT_SETTINGS.yPos;
    const zoom = Number.isFinite(raw.zoom) ? Number(raw.zoom) : DEFAULT_SETTINGS.zoom;
    return {
      gifUrl: (raw.gifUrl || "").trim(),
      xPos: Math.max(0, Math.min(100, xPos)),
      yPos: Math.max(0, Math.min(100, yPos)),
      zoom: Math.max(1, Math.min(2.5, zoom))
    };
  }
  function readSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(Object.values(STORAGE_KEYS), (data) => {
        resolve(
          sanitizeSettings({
            gifUrl: data[STORAGE_KEYS.gifUrl],
            xPos: data[STORAGE_KEYS.xPos],
            yPos: data[STORAGE_KEYS.yPos],
            zoom: data[STORAGE_KEYS.zoom]
          })
        );
      });
    });
  }

  // src/content/main.ts
  var TARGET_PROFILE = "tusharvarshney03";
  var CANVAS_ID = "livecard-canvas-banner";
  var GIF_ID = "livecard-gif-banner";
  var RETRY_LIMIT = 80;
  function currentHandle() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const inIndex = parts.indexOf("in");
    if (inIndex === -1 || !parts[inIndex + 1]) return null;
    return parts[inIndex + 1].toLowerCase();
  }
  function isTargetProfile() {
    return currentHandle() === TARGET_PROFILE;
  }
  function findBannerImage() {
    const images = Array.from(document.querySelectorAll("img"));
    return images.map((img) => {
      const rect = img.getBoundingClientRect();
      const src = (img.currentSrc || img.src || "").toLowerCase();
      const ratio = rect.width / Math.max(rect.height, 1);
      const area = rect.width * rect.height;
      const srcLooksRight = src.includes("background") || src.includes("banner") || src.includes("displaybackgroundimage");
      return { img, rect, ratio, area, srcLooksRight };
    }).filter(
      ({ rect, ratio }) => rect.width > 500 && rect.height > 100 && rect.height < 450 && ratio > 2.3 && rect.top > 30 && rect.top < 450
    ).sort((a, b) => {
      if (a.srcLooksRight !== b.srcLooksRight) return a.srcLooksRight ? -1 : 1;
      return b.area - a.area;
    })[0];
  }
  function drawImageCover(ctx, image, targetW, targetH) {
    const srcW = image.naturalWidth || image.width;
    const srcH = image.naturalHeight || image.height;
    if (!srcW || !srcH) return;
    const srcRatio = srcW / srcH;
    const dstRatio = targetW / targetH;
    let cropW = srcW;
    let cropH = srcH;
    let cropX = 0;
    let cropY = 0;
    if (srcRatio > dstRatio) {
      cropW = srcH * dstRatio;
      cropX = (srcW - cropW) / 2;
    } else {
      cropH = srcW / dstRatio;
      cropY = (srcH - cropH) / 2;
    }
    ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
  }
  function insertFallbackCanvas(container, width, height) {
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    const canvas = document.createElement("canvas");
    canvas.id = CANVAS_ID;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.cssText = "position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;z-index:9998!important;pointer-events:none!important;";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stars = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1 + 0.2,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.05 + 0.015,
      alpha: Math.random() * 0.45 + 0.15
    }));
    const bg = new Image();
    bg.onload = () => {
      let t = 0;
      const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawImageCover(ctx, bg, canvas.width, canvas.height);
        for (const s of stars) {
          const a = s.alpha * (0.45 + 0.55 * Math.sin(t * s.speed + s.phase));
          ctx.beginPath();
          ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.fill();
        }
        t += 1;
        requestAnimationFrame(draw);
      };
      draw();
    };
    bg.src = chrome.runtime.getURL("space.jpg");
  }
  function insertGifOverlay(container, gifUrl, xPos, yPos, zoom) {
    const gif = document.createElement("img");
    gif.id = GIF_ID;
    gif.src = gifUrl;
    gif.alt = "Livecard animated banner";
    gif.style.cssText = "position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;z-index:9999!important;display:block!important;pointer-events:none!important;";
    gif.style.objectPosition = `${xPos}% ${yPos}%`;
    gif.style.transformOrigin = "center center";
    gif.style.transform = `scale(${zoom})`;
    container.appendChild(gif);
  }
  function clearInjected() {
    document.getElementById(CANVAS_ID)?.remove();
    document.getElementById(GIF_ID)?.remove();
  }
  async function inject() {
    if (!isTargetProfile()) return false;
    if (document.getElementById(CANVAS_ID) || document.getElementById(GIF_ID)) return true;
    const candidate = findBannerImage();
    if (!candidate) return false;
    const { img, rect } = candidate;
    const container = img.closest("div");
    if (!container || rect.width < 250 || rect.height < 80) return false;
    container.style.setProperty("position", "relative", "important");
    container.style.setProperty("overflow", "hidden", "important");
    container.style.setProperty("min-height", `${Math.max(180, rect.height)}px`, "important");
    img.style.setProperty("opacity", "0", "important");
    img.style.setProperty("visibility", "hidden", "important");
    const settings = await readSettings();
    if (settings.gifUrl) {
      insertGifOverlay(container, settings.gifUrl, settings.xPos, settings.yPos, settings.zoom);
    } else {
      insertFallbackCanvas(container, rect.width, rect.height);
    }
    return true;
  }
  function bootstrap(attempt = 0) {
    inject().then((ok) => {
      if (!ok && attempt < RETRY_LIMIT) window.setTimeout(() => bootstrap(attempt + 1), 350);
    });
  }
  var lastUrl = location.href;
  var observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearInjected();
      window.setTimeout(() => bootstrap(), 550);
      return;
    }
    if (isTargetProfile() && !document.getElementById(CANVAS_ID) && !document.getElementById(GIF_ID)) {
      window.setTimeout(() => bootstrap(), 220);
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "LIVECARD_RELOAD") return;
    clearInjected();
    window.setTimeout(() => bootstrap(), 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  bootstrap();
  window.addEventListener("load", () => bootstrap());
  window.addEventListener("resize", () => {
    if (!isTargetProfile()) return;
    clearInjected();
    window.setTimeout(() => bootstrap(), 300);
  });
})();
