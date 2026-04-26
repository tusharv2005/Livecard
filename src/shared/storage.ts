export const STORAGE_KEYS = {
  gifUrl: "livecardGifUrl",
  xPos: "livecardGifPosX",
  yPos: "livecardGifPosY",
  zoom: "livecardGifZoom",
} as const;

export type LivecardSettings = {
  gifUrl: string;
  xPos: number;
  yPos: number;
  zoom: number;
};

export const DEFAULT_SETTINGS: LivecardSettings = {
  gifUrl: "",
  xPos: 50,
  yPos: 50,
  zoom: 1,
};

export function sanitizeSettings(raw: Partial<LivecardSettings>): LivecardSettings {
  const xPos = Number.isFinite(raw.xPos) ? Number(raw.xPos) : DEFAULT_SETTINGS.xPos;
  const yPos = Number.isFinite(raw.yPos) ? Number(raw.yPos) : DEFAULT_SETTINGS.yPos;
  const zoom = Number.isFinite(raw.zoom) ? Number(raw.zoom) : DEFAULT_SETTINGS.zoom;

  return {
    gifUrl: (raw.gifUrl || "").trim(),
    xPos: Math.max(0, Math.min(100, xPos)),
    yPos: Math.max(0, Math.min(100, yPos)),
    zoom: Math.max(1, Math.min(2.5, zoom)),
  };
}

export function readSettings(): Promise<LivecardSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(Object.values(STORAGE_KEYS), (data) => {
      resolve(
        sanitizeSettings({
          gifUrl: data[STORAGE_KEYS.gifUrl],
          xPos: data[STORAGE_KEYS.xPos],
          yPos: data[STORAGE_KEYS.yPos],
          zoom: data[STORAGE_KEYS.zoom],
        })
      );
    });
  });
}

export function writeSettings(settings: LivecardSettings): Promise<void> {
  const next = sanitizeSettings(settings);
  return new Promise((resolve) => {
    chrome.storage.sync.set(
      {
        [STORAGE_KEYS.gifUrl]: next.gifUrl,
        [STORAGE_KEYS.xPos]: next.xPos,
        [STORAGE_KEYS.yPos]: next.yPos,
        [STORAGE_KEYS.zoom]: next.zoom,
      },
      () => resolve()
    );
  });
}
