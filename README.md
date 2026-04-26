# Livecard

Livecard is a Chrome extension that overlays an animated banner on `linkedin.com/in/tusharvarshney03`.

Users can paste a media URL (direct GIF/WEBP or webpage URL), preview the result, adjust banner alignment and zoom, and save settings that persist across refreshes.

## Features

- React + TypeScript popup UI.
- Content script injection for LinkedIn profile banner replacement.
- URL resolver for non-direct links (extracts candidate media from page metadata/markup).
- Live preview before saving:
  - horizontal position
  - vertical position
  - zoom
- Persistent settings using `chrome.storage.sync`.
- Automatic reinjection on load, LinkedIn SPA navigation, and rerenders.
- Banner overlay applies when a media URL is saved.

## Project Structure

- `src/popup/` - React popup app.
- `src/content/` - TypeScript content script.
- `src/shared/` - storage and shared types.
- `scripts/build.mjs` - esbuild bundling for extension runtime files.
- `popup.js` - built popup bundle (generated).
- `content-main.js` - built content script bundle (generated).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build extension bundles:

   ```bash
   npm run build
   ```

3. Load extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select this project folder

## Development Workflow

- Run a one-time build:

  ```bash
  npm run build
  ```

- Run watch mode while developing:

  ```bash
  npm run watch
  ```

Then reload the extension in `chrome://extensions`.

## Usage

1. Open Livecard popup.
2. Paste a URL in the input:
   - direct media URL (`.gif`, `.webp`) OR
   - webpage URL (Livecard resolves a media asset from page HTML)
3. Use preview controls to adjust position and zoom.
4. Click **Save Livecard**.
5. Refresh LinkedIn once if needed; settings persist afterward.

## Permissions

- `activeTab`: message active tab to refresh injected banner.
- `storage`: persist GIF URL and alignment settings.
- `host_permissions <all_urls>`: resolve media from arbitrary webpage URLs.

## Notes

- LinkedIn does not natively support animated profile banners.
- This extension works client-side for users who install it.
