import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SETTINGS, LivecardSettings, sanitizeSettings, writeSettings, readSettings } from "../shared/storage";

const DEFAULT_INPUT_URL = "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNnRzeHhzd2x2MGl1aGM1dWRod2hxYnd6N3E1dTljd2VzdWtuNm5yOSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/pVGsAWjzvXcZW4ZBTE/giphy.gif";

function isGifLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const full = `${path}${url.search}`.toLowerCase();
    return (
      path.endsWith(".gif") ||
      path.endsWith(".webp") ||
      path.endsWith(".png") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      full.includes(".gif") ||
      full.includes(".webp") ||
      full.includes("format=gif") ||
      full.includes("format=webp")
    );
  } catch {
    return false;
  }
}

function absolutize(candidate: string, baseUrl: string): string {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return candidate;
  }
}

function extractMediaCandidatesFromHtml(html: string, baseUrl: string): string[] {
  const found = new Set<string>();

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(html);
    while (match) {
      const raw = (match[1] || "").trim();
      if (raw) found.add(absolutize(raw, baseUrl));
      match = pattern.exec(html);
    }
  }

  return Array.from(found);
}

function scoreCandidate(url: string): number {
  const lower = url.toLowerCase();
  if (lower.endsWith(".gif")) return 100;
  if (lower.endsWith(".webp")) return 90;
  if (lower.endsWith(".mp4") || lower.endsWith(".webm")) return 80;
  if (lower.includes("googleusercontent.com")) return 65;
  if (lower.includes("giphy") || lower.includes("tenor") || lower.includes("tumblr")) return 70;
  if (lower.includes("sprite") || lower.includes("logo") || lower.includes("avatar")) return -10;
  if (lower.match(/\.(jpg|jpeg|png)(\?|$)/)) return 10;
  return 0;
}

async function fetchHtml(url: string): Promise<string> {
  const direct = await fetch(url);
  if (direct.ok) return await direct.text();
  throw new Error(`Failed to fetch page: ${direct.status}`);
}

async function fetchHtmlViaProxy(url: string): Promise<string> {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (res.ok) return await res.text();
  throw new Error(`Proxy fetch failed: ${res.status}`);
}

async function resolveToBannerMedia(inputUrl: string): Promise<string> {
  const trimmed = inputUrl.trim();
  if (isGifLikeUrl(trimmed)) return trimmed;

  let html = "";
  try {
    html = await fetchHtml(trimmed);
  } catch {
    html = await fetchHtmlViaProxy(trimmed);
  }

  const candidates = extractMediaCandidatesFromHtml(html, trimmed)
    .filter((u) => u.startsWith("http://") || u.startsWith("https://"))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  const best = candidates[0];
  if (!best) {
    throw new Error("Could not find media in this page. Try another URL.");
  }

  return best;
}

async function notifyActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "LIVECARD_RELOAD" }, () => void chrome.runtime.lastError);
}

export function App() {
  const [settings, setSettings] = useState<LivecardSettings>({
    ...DEFAULT_SETTINGS,
    gifUrl: DEFAULT_INPUT_URL,
  });
  const [inputUrl, setInputUrl] = useState(DEFAULT_INPUT_URL);
  const [previewUrl, setPreviewUrl] = useState(DEFAULT_INPUT_URL);
  const [isResolvingPreview, setIsResolvingPreview] = useState(false);
  const [previewLoadError, setPreviewLoadError] = useState(false);
  const [message, setMessage] = useState("Paste GIF URL, preview and adjust before saving.");

  useEffect(() => {
    readSettings().then((saved) => {
      if (!saved.gifUrl) {
        setSettings({ ...saved, gifUrl: DEFAULT_INPUT_URL });
        setInputUrl(DEFAULT_INPUT_URL);
        setPreviewUrl(DEFAULT_INPUT_URL);
        return;
      }
      setSettings(saved);
      setInputUrl(saved.gifUrl);
      setPreviewUrl(saved.gifUrl);
    });
  }, []);

  useEffect(() => {
    const trimmed = inputUrl.trim();
    if (!trimmed) {
      setPreviewUrl("");
      setPreviewLoadError(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsResolvingPreview(true);
      try {
        const resolved = await resolveToBannerMedia(trimmed);
        if (cancelled) return;
        setPreviewUrl(resolved);
        setPreviewLoadError(false);
        setMessage("Preview updated.");
      } catch {
        if (cancelled) return;
        setPreviewUrl(trimmed);
        setPreviewLoadError(false);
      } finally {
        if (!cancelled) setIsResolvingPreview(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputUrl]);

  const previewStyle = useMemo(
    () => ({
      objectFit: "cover" as const,
      objectPosition: `${settings.xPos}% ${settings.yPos}%`,
      transform: `scale(${settings.zoom})`,
      transformOrigin: "center center",
      width: "100%",
      height: "100%",
      display: "block",
    }),
    [settings.xPos, settings.yPos, settings.zoom]
  );

  const onChange = (next: Partial<LivecardSettings>) => {
    setSettings((prev) => sanitizeSettings({ ...prev, ...next }));
  };

  const save = async () => {
    try {
      const source = inputUrl.trim();
      const resolvedUrl = source ? await resolveToBannerMedia(source) : "";
      const next = sanitizeSettings({ ...settings, gifUrl: resolvedUrl });
      setSettings(next);
      setInputUrl(resolvedUrl);
      setPreviewUrl(resolvedUrl);
      setPreviewLoadError(false);
      await writeSettings(next);
      await notifyActiveTab();
      setMessage("Saved. URL resolved and applied. Refresh LinkedIn once if needed.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not resolve media URL.";
      setMessage(text);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.title}>LIVECARD</div>
        <div style={styles.sub}>LinkedIn Animated Banner</div>
      </div>

      <div style={styles.body}>
        <label style={styles.label}>GIF URL</label>
        <input
          style={styles.input}
          value={inputUrl}
          onChange={(e) => {
            const nextUrl = e.target.value;
            setInputUrl(nextUrl);
            onChange({ gifUrl: nextUrl });
          }}
          placeholder="https://example.com/banner.gif"
        />

        <div style={styles.previewWrap}>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="GIF preview"
              style={previewStyle}
              onLoad={() => setPreviewLoadError(false)}
              onError={() => setPreviewLoadError(true)}
            />
          ) : (
            <div style={styles.previewEmpty}>Preview appears here</div>
          )}
          {previewLoadError ? (
            <div style={styles.previewErrorBadge}>
              Preview failed for this URL (host may block hotlinking)
            </div>
          ) : null}
        </div>
        {isResolvingPreview ? <div style={styles.message}>Resolving preview URL...</div> : null}

        <label style={styles.label}>Vertical Position ({Math.round(settings.yPos)}%)</label>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.yPos}
          onChange={(e) => onChange({ yPos: Number(e.target.value) })}
        />

        <label style={styles.label}>Zoom ({settings.zoom.toFixed(2)}x)</label>
        <input
          type="range"
          min={1}
          max={2.5}
          step={0.01}
          value={settings.zoom}
          onChange={(e) => onChange({ zoom: Number(e.target.value) })}
        />

        <button style={styles.saveButton} onClick={save}>
          Save Livecard
        </button>
        <button
          style={styles.visitButton}
          onClick={() => chrome.tabs.create({ url: "https://www.linkedin.com/in/tusharvarshney03/" })}
        >
          Visit LinkedIn Profile
        </button>

        <div style={styles.message}>{message}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: 340,
    minHeight: 520,
    fontFamily: "Inter, system-ui, Arial, sans-serif",
    background: "#070f2a",
    color: "#edf3ff",
  },
  header: {
    padding: "14px 16px",
    borderBottom: "1px solid rgba(120,160,240,0.25)",
    background: "linear-gradient(135deg, rgba(70,50,190,0.45), rgba(25,95,215,0.35))",
  },
  title: { fontSize: 15, fontWeight: 800, letterSpacing: "0.08em" },
  sub: { fontSize: 11, opacity: 0.8, marginTop: 2 },
  body: { padding: 14, display: "grid", gap: 10 },
  label: { fontSize: 11, color: "rgba(190,220,255,0.95)" },
  input: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(120,160,240,0.45)",
    background: "rgba(6,14,42,0.95)",
    color: "#fff",
  },
  previewWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "1584 / 396",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid rgba(120,160,240,0.35)",
    background: "#02091f",
  },
  previewEmpty: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    color: "rgba(180,200,240,0.6)",
    fontSize: 12,
  },
  previewErrorBadge: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid rgba(255,150,150,0.75)",
    background: "rgba(80,14,20,0.9)",
    color: "#ffd7d7",
    fontSize: 10,
    lineHeight: 1.3,
    textAlign: "center",
    pointerEvents: "none",
  },
  saveButton: {
    marginTop: 4,
    border: "1px solid rgba(65,230,155,0.65)",
    background: "rgba(21,127,86,0.8)",
    color: "#e9ffef",
    borderRadius: 8,
    padding: "10px 12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  visitButton: {
    border: "1px solid rgba(132,145,255,0.65)",
    background: "rgba(56,71,188,0.75)",
    color: "#edf1ff",
    borderRadius: 8,
    padding: "10px 12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  message: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 1.4,
    color: "rgba(185,220,255,0.9)",
  },
};
