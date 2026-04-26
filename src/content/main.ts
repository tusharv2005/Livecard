import { readSettings } from "../shared/storage";

const TARGET_PROFILE = "tusharvarshney03";
const GIF_ID = "livecard-gif-banner";
const RETRY_LIMIT = 80;

function currentHandle(): string | null {
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
  return images
    .map((img) => {
      const rect = img.getBoundingClientRect();
      const src = (img.currentSrc || img.src || "").toLowerCase();
      const ratio = rect.width / Math.max(rect.height, 1);
      const area = rect.width * rect.height;
      const srcLooksRight =
        src.includes("background") ||
        src.includes("banner") ||
        src.includes("displaybackgroundimage");
      return { img, rect, ratio, area, srcLooksRight };
    })
    .filter(
      ({ rect, ratio }) =>
        rect.width > 500 &&
        rect.height > 100 &&
        rect.height < 450 &&
        ratio > 2.3 &&
        rect.top > 30 &&
        rect.top < 450
    )
    .sort((a, b) => {
      if (a.srcLooksRight !== b.srcLooksRight) return a.srcLooksRight ? -1 : 1;
      return b.area - a.area;
    })[0];
}

function insertGifOverlay(
  container: HTMLElement,
  gifUrl: string,
  xPos: number,
  yPos: number,
  zoom: number
) {
  const gif = document.createElement("img");
  gif.id = GIF_ID;
  gif.src = gifUrl;
  gif.alt = "Livecard animated banner";
  gif.style.cssText =
    "position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;z-index:9999!important;display:block!important;pointer-events:none!important;";
  gif.style.objectPosition = `${xPos}% ${yPos}%`;
  gif.style.transformOrigin = "center center";
  gif.style.transform = `scale(${zoom})`;
  container.appendChild(gif);
}

function clearInjected() {
  document.getElementById(GIF_ID)?.remove();
}

async function inject(): Promise<boolean> {
  if (!isTargetProfile()) return false;
  if (document.getElementById(GIF_ID)) return true;

  const candidate = findBannerImage();
  if (!candidate) return false;

  const { img, rect } = candidate;
  const container = img.closest("div") as HTMLElement | null;
  if (!container || rect.width < 250 || rect.height < 80) return false;

  const settings = await readSettings();
  if (settings.gifUrl) {
    container.style.setProperty("position", "relative", "important");
    container.style.setProperty("overflow", "hidden", "important");
    container.style.setProperty("min-height", `${Math.max(180, rect.height)}px`, "important");
    img.style.setProperty("opacity", "0", "important");
    img.style.setProperty("visibility", "hidden", "important");
    insertGifOverlay(container, settings.gifUrl, settings.xPos, settings.yPos, settings.zoom);
    return true;
  }

  return false;
}

function bootstrap(attempt = 0) {
  inject().then((ok) => {
    if (!ok && attempt < RETRY_LIMIT) window.setTimeout(() => bootstrap(attempt + 1), 350);
  });
}

let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    clearInjected();
    window.setTimeout(() => bootstrap(), 550);
    return;
  }
  if (isTargetProfile() && !document.getElementById(GIF_ID)) {
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
