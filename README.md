# Ego

**See what's tracking you. Take control.**

Ego is a browser extension that shows you exactly what's tracking you on every page you visit — in plain language, not developer jargon. It tells you which companies are watching, what data they're collecting, and gives you simple tools to do something about it.

## Features

- **Tracker visibility** — see every tracker on the current page, identified by company name
- **Data type labels** — know exactly what each tracker collects (location, browsing history, device info, etc.)
- **Category blocking** — block entire categories: advertising, analytics, social, fingerprinting
- **GPC opt-out** — enforce Global Privacy Control, legally requesting sites not to sell your data
- **Clear site data** — one tap to wipe cookies and storage for any site
- **100% local** — nothing leaves your browser. No accounts, no backend, no telemetry.

## Install

### Chrome
1. Download or clone this repo
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `extension/` folder

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `extension/manifest-firefox.json`

## Privacy

Ego runs entirely on your device. It makes zero network requests. The tracker database ships with the extension and is matched locally. We believe a privacy tool should practice what it preaches.

## Open Source

Ego's core is open source. Read the code, verify our claims, contribute improvements. Future paid features will live in a separate repository.

## Built by

[Usual Systems](https://usual.systems)

## License

MIT
