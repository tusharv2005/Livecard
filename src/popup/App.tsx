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

function isRenderableMediaUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    isGifLikeUrl(value) ||
    /\.(png|jpg|jpeg|webp)(\?|$)/.test(lower) ||
    lower.includes("giphy.com/media/") ||
    lower.includes("media.tenor.com/") ||
    lower.includes("tenor.googleapis.com/")
  );
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
  if (isRenderableMediaUrl(trimmed)) return trimmed;

  let html = "";
  try {
    html = await fetchHtml(trimmed);
  } catch {
    html = await fetchHtmlViaProxy(trimmed);
  }

  const candidates = extractMediaCandidatesFromHtml(html, trimmed)
    .filter((u) => u.startsWith("http://") || u.startsWith("https://"))
    .filter((u) => isRenderableMediaUrl(u))
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
        // Do not render regular webpage URLs as <img>, which triggers CSP noise.
        setPreviewUrl(isRenderableMediaUrl(trimmed) ? trimmed : "");
        setPreviewLoadError(false);
        if (!isRenderableMediaUrl(trimmed)) {
          setMessage("Use a direct media URL. Page links (like tenor.com pages) may be blocked in preview.");
        }
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
        <div style={styles.eyebrow}>LinkedIn Animated Banner</div>
        <div style={styles.title}>Livecard Studio</div>
        <div style={styles.sub}>Paste a link, tweak preview, then save.</div>
      </div>

      <div style={styles.body}>
        <div style={styles.panel}>
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
          <div style={styles.helpText}>
            Use direct media links (for example `media.tenor.com`, `giphy.com/media`, or a `.gif` URL).
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.labelRow}>
            <label style={styles.label}>Preview</label>
            {isResolvingPreview ? <span style={styles.hint}>Resolving...</span> : null}
          </div>
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
        </div>

        <div style={styles.panel}>
          <label style={styles.label}>Vertical Position ({Math.round(settings.yPos)}%)</label>
          <input
            style={styles.slider}
            type="range"
            min={0}
            max={100}
            value={settings.yPos}
            onChange={(e) => onChange({ yPos: Number(e.target.value) })}
          />

          <label style={styles.label}>Zoom ({settings.zoom.toFixed(2)}x)</label>
          <input
            style={styles.slider}
            type="range"
            min={1}
            max={2.5}
            step={0.01}
            value={settings.zoom}
            onChange={(e) => onChange({ zoom: Number(e.target.value) })}
          />
        </div>

        <div style={styles.buttonRow}>
          <button style={styles.saveButton} onClick={save}>
            Save Livecard
          </button>
          <button
            style={styles.visitButton}
            onClick={() => chrome.tabs.create({ url: "https://www.linkedin.com/in/tusharvarshney03/" })}
          >
            Visit LinkedIn Profile
          </button>
        </div>

        <div style={styles.message}>{message}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: 340,
    minHeight: 520,
    fontFamily: "'Inter', 'Avenir Next', system-ui, Arial, sans-serif",
    background: "linear-gradient(180deg, #f6efe6 0%, #efe5d8 100%)",
    color: "#2d2218",
  },
  header: {
    padding: "14px 16px 12px",
    borderBottom: "1px solid rgba(114,82,56,0.15)",
    background: "linear-gradient(135deg, rgba(255,253,248,0.95), rgba(244,232,217,0.9))",
  },
  eyebrow: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "rgba(95,66,43,0.7)",
    fontWeight: 700,
    marginBottom: 3,
  },
  title: { fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em", color: "#3b2b1f" },
  sub: { fontSize: 12, opacity: 0.85, marginTop: 4, color: "#654d3a" },
  body: { padding: 12, display: "grid", gap: 10 },
  panel: {
    background: "rgba(255, 252, 247, 0.92)",
    border: "1px solid rgba(133,97,67,0.2)",
    borderRadius: 12,
    padding: 10,
    display: "grid",
    gap: 8,
    boxShadow: "0 2px 10px rgba(68, 40, 18, 0.08)",
  },
  label: { fontSize: 11, color: "#6a4f3a", fontWeight: 600 },
  labelRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  hint: { fontSize: 10, color: "#99714f", fontWeight: 600 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 10px",
    borderRadius: 8,
    border: "1px solid rgba(143,106,72,0.35)",
    background: "#fffaf3",
    color: "#2e2219",
    fontSize: 12,
    lineHeight: 1.35,
    outline: "none",
  },
  helpText: {
    fontSize: 10,
    color: "#8b6a4d",
    lineHeight: 1.35,
  },
  previewWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "1584 / 396",
    borderRadius: 10,
    overflow: "hidden",
    border: "1px solid rgba(143,106,72,0.3)",
    background: "#f4eadf",
  },
  previewEmpty: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    color: "rgba(110,80,56,0.75)",
    fontSize: 12,
  },
  previewErrorBadge: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid rgba(178,105,94,0.7)",
    background: "rgba(116,56,46,0.9)",
    color: "#ffe3dc",
    fontSize: 10,
    lineHeight: 1.3,
    textAlign: "center",
    pointerEvents: "none",
  },
  slider: {
    accentColor: "#8b5f3c",
  },
  buttonRow: {
    display: "grid",
    gap: 8,
  },
  saveButton: {
    border: "1px solid rgba(118,80,48,0.65)",
    background: "linear-gradient(180deg, #8f6241, #7b5337)",
    color: "#fff8ef",
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  visitButton: {
    border: "1px solid rgba(123,95,68,0.5)",
    background: "linear-gradient(180deg, #f5ebe0, #eedfce)",
    color: "#513929",
    borderRadius: 10,
    padding: "10px 12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  message: {
    fontSize: 11,
    lineHeight: 1.4,
    color: "#6b4f3a",
    background: "rgba(255,248,238,0.9)",
    border: "1px solid rgba(133,97,67,0.2)",
    borderRadius: 10,
    padding: "8px 10px",
  },
};
