# Stigma

**See what's tracking you.**

Stigma is a browser extension that makes tracking visible, in plain language, and lets you do something about it. Open source, 100% local, honest about what it does and doesn't do.

Live at [stigma.usual.systems](https://stigma.usual.systems).

---

## What it does

- Lists every tracker active on the page you are currently viewing
- Labels each one by company, product, category, and the specific types of data it collects
- Lets you block individual trackers or whole categories across every site
- Sends Global Privacy Control opt-out signals to sites that honor them
- Clears cookies and site data in one click
- Runs entirely in your browser. No accounts, no servers, no telemetry

## Principles

1. **Visibility first.** Most privacy tools block quietly in the background. Stigma makes the tracking legible. You understand what is happening before you act on it.
2. **Plain language, not jargon.** No "fingerprinting vectors" or "cross-domain request surfaces." Stigma describes what companies are doing in words you do not have to translate.
3. **Local only.** Everything happens in your browser. The extension does not communicate with any server, analytics provider, or third party. Not ours, not anyone else's.
4. **Honest about limits.** Stigma cannot delete data companies already have, cannot reach data brokers who already bought your profile, and cannot replace a full privacy stack. It is one piece of a larger effort.

## Install

**From the Chrome Web Store:** coming soon.

**From source (development):**

Chrome / Edge / Brave:
1. Clone or download this repository
2. Open `chrome://extensions`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `extension/` folder

Firefox:
1. Clone or download this repository
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select `extension/manifest-firefox.json`

## Permissions

Stigma requests the following permissions. Each is used for a specific feature, and all processing stays local.

| Permission | Why |
|------------|-----|
| `activeTab` | Read which trackers are active on the tab you are currently viewing |
| `storage` | Save your blocking preferences locally on your device |
| `cookies` | Used by the "Clear Site Data" button to clear cookies on the current site |
| `browsingData` | Used by "Clear Site Data" to clear cache and local storage on the current site |
| `declarativeNetRequest` | Block tracker requests based on the categories you have chosen |
| `declarativeNetRequestFeedback` | Show accurate tracker counts in the popup |
| `webNavigation` | Reset tracker counts when you navigate to a new page |
| `webRequest` | Observe tracker requests to identify and categorize them |
| `tabs` | Identify the currently active tab so the popup shows the right data |
| `host_permissions: <all_urls>` | Tracking happens on any site, so Stigma needs to observe requests on any site |

Full privacy policy: [stigma.usual.systems/privacy](https://stigma.usual.systems/privacy)

## Development

Stigma is vanilla JavaScript. No bundler, no framework, no build step.

```bash
cd extension
npm install      # install Vitest for testing
npm test         # run the test suite
npm run test:watch
```

### Project structure

```
stigma/
├── README.md
├── LICENSE
└── extension/
    ├── background.js           # MV3 service worker
    ├── content.js              # content script
    ├── manifest.json           # Chrome manifest (MV3)
    ├── manifest-firefox.json   # Firefox manifest
    ├── popup/                  # extension popup UI
    ├── options/                # options page
    ├── lib/                    # shared modules (matcher, categorizer, storage)
    ├── data/                   # tracker database
    ├── icons/                  # extension icons
    └── tests/                  # Vitest test suites
```

## Feedback and issues

Found a bug, a tracker Stigma missed, or a site where it breaks something? Open an issue on GitHub. This is a small project and we read every report.

## Author

Built by [Usual Systems](https://usual.systems).

Contact: cpugsley@usual.systems

## License

Stigma is licensed under the [GNU General Public License v3.0](./LICENSE). You are free to use, modify, and redistribute Stigma, including for commercial purposes, provided that any distributed derivative works are also licensed under the GPL v3 and made available as source.
