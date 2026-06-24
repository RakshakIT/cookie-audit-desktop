# Cookie Audit Scanner Desktop

Electron desktop app for full-site cookie scanning using Chromium automation through Playwright.

## What this solves

The Chrome extension version cannot run Playwright or a local backend by itself. This desktop version runs the scanner inside the app.

## Development run

```bash
npm install
npm start
```

The `postinstall` script installs Chromium for Playwright.

## Build installers

Windows:

```bash
npm run build:win
```

macOS:

```bash
npm run build:mac
```

Linux:

```bash
npm run build:linux
```

Output appears in `dist/`.

## Important limits

This is a best-effort audit. Cookie appearance can depend on consent choice, login state, location, A/B testing, user actions, embedded third parties, and blocked requests. The report should not claim to prove every possible cookie a site may ever set.
