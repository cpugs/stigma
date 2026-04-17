import { extractDomain, lookupTracker, aggregateTrackers, getBadgeColor, getBadgeCount } from './lib/tracker-matcher.js';

// Per-tab tracker storage: tabId -> Map<domain, trackerInfo>
const tabTrackers = new Map();

// Per-tab unknown third-party domain count: tabId -> Set<domain>
const tabUnknownDomains = new Map();

// Domains that are third-party but not trackers (CDNs, fonts, infrastructure)
const NON_TRACKING_DOMAINS = new Set([
  // CDNs
  'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'ajax.googleapis.com',
  'stackpath.bootstrapcdn.com', 'maxcdn.bootstrapcdn.com', 'cdn.cloudflare.com',
  'fastly.net', 'akamaized.net', 'cloudfront.net', 'azureedge.net',
  'staticfile.org', 'rawgit.com', 'raw.githubusercontent.com',
  // Fonts
  'fonts.gstatic.com', 'use.typekit.net', 'fast.fonts.net', 'use.fontawesome.com',
  // Common infrastructure
  'maps.googleapis.com', 'maps.gstatic.com', 'translate.googleapis.com',
  'recaptcha.net', 'www.recaptcha.net', 'www.gstatic.com', 'ssl.gstatic.com',
  // Video players (the player itself, not analytics)
  'www.youtube.com', 'player.vimeo.com', 'content.jwplatform.com',
  // Common JS libraries
  'code.jquery.com', 'polyfill.io',
  // Payment (not tracking)
  'js.braintreegateway.com', 'checkout.stripe.com',
]);

// Loaded tracker database
let trackerDB = {};

// User preferences (persisted to chrome.storage.local)
let prefs = {
  gpcEnabled: false,
  blockedCategories: [],
};

// --- Initialization ---

async function init() {
  // Load tracker database
  const response = await fetch(chrome.runtime.getURL('data/trackers.json'));
  const data = await response.json();
  trackerDB = data.trackers;
  console.log(`Stigma: loaded ${Object.keys(trackerDB).length} tracker entries`);

  // Load saved preferences
  const stored = await chrome.storage.local.get(['prefs']);
  if (stored.prefs) {
    prefs = { ...prefs, ...stored.prefs };
  }

  // Set up GPC rules if enabled
  if (prefs.gpcEnabled) {
    enableGPC();
  }

  // Set up blocking rules for blocked categories
  updateBlockingRules();
}

init();

// --- Request Monitoring ---

// Listen for completed requests to detect trackers
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return; // ignore non-tab requests

    const domain = extractDomain(details.url);
    if (!domain) return;

    const tracker = lookupTracker(domain, trackerDB);

    // If not in our DB, check if it's a third-party domain (potential unknown tracker)
    if (!tracker) {
      // Get the tab's own domain to compare
      const tabDomains = tabTrackers.get(details.tabId);
      // Only count script/image/xhr requests from other domains as potential trackers
      const isTrackingType = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping'].includes(details.type);
      if (isTrackingType && details.tabId >= 0) {
        // Skip known non-tracking domains
        if (isWhitelistedDomain(domain)) return;

        chrome.tabs.get(details.tabId, (tab) => {
          if (chrome.runtime.lastError || !tab?.url) return;
          const tabDomain = extractDomain(tab.url);
          if (tabDomain && domain !== tabDomain && !domain.endsWith('.' + tabDomain)) {
            if (!tabUnknownDomains.has(details.tabId)) {
              tabUnknownDomains.set(details.tabId, new Set());
            }
            tabUnknownDomains.get(details.tabId).add(domain);
          }
        });
      }
      return;
    }

    // Store known tracker for this tab
    if (!tabTrackers.has(details.tabId)) {
      tabTrackers.set(details.tabId, new Map());
    }
    tabTrackers.get(details.tabId).set(domain, tracker);

    // Update badge
    updateBadge(details.tabId);
  },
  { urls: ['<all_urls>'] }
);

// Clear tracker data when a tab navigates to a new page
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // only top-level navigation
  tabTrackers.delete(details.tabId);
  tabUnknownDomains.delete(details.tabId);
  updateBadge(details.tabId);
});

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  tabTrackers.delete(tabId);
  tabUnknownDomains.delete(tabId);
});

// Update badge when switching tabs
chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateBadge(tabId);
});

// --- Badge ---

function updateBadge(tabId) {
  const trackers = tabTrackers.get(tabId);
  const matches = trackers ? [...trackers.values()] : [];
  const aggregated = aggregateTrackers(matches);
  const count = aggregated.length;

  chrome.action.setBadgeText({ text: getBadgeCount(count), tabId });
  chrome.action.setBadgeBackgroundColor({ color: getBadgeColor(count), tabId });
}

// --- GPC (Global Privacy Control) ---

function enableGPC() {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [9999],
    addRules: [{
      id: 9999,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Sec-GPC', operation: 'set', value: '1' },
        ],
      },
      condition: {
        urlFilter: '*',
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'stylesheet', 'other'],
      },
    }],
  });
}

function disableGPC() {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [9999],
    addRules: [],
  });
}

// --- Category Blocking ---

// Rule IDs: advertising=1000, analytics=2000, social=3000, fingerprinting=4000
const CATEGORY_RULE_BASE = {
  advertising: 1000,
  analytics: 2000,
  social: 3000,
  fingerprinting: 4000,
};

function updateBlockingRules() {
  // Build block rules from tracker DB for each blocked category
  const removeIds = [];
  const addRules = [];

  for (const [category, baseId] of Object.entries(CATEGORY_RULE_BASE)) {
    // Collect all domains in this category
    const domains = Object.entries(trackerDB)
      .filter(([, info]) => info.category === category)
      .map(([domain]) => domain);

    // Remove old rules for this category (up to 500 per category)
    for (let i = 0; i < 500; i++) {
      removeIds.push(baseId + i);
    }

    // Add new rules only if category is blocked
    if (prefs.blockedCategories.includes(category)) {
      domains.forEach((domain, i) => {
        if (i >= 500) return; // safety cap
        addRules.push({
          id: baseId + i,
          priority: 2,
          action: { type: 'block' },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'other'],
          },
        });
      });
    }
  }

  chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules });
}

// --- Message Handling (from popup and content script) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getTrackers') {
    // Popup requests tracker list for the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ trackers: [], domain: '', unknownCount: 0, blockedCategories: [] });
        return;
      }
      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url || '';
      const siteDomain = extractDomain(tabUrl) || '';
      const trackers = tabTrackers.get(tabId);
      const matches = trackers ? [...trackers.values()] : [];
      const aggregated = aggregateTrackers(matches);
      const unknownDomains = tabUnknownDomains.get(tabId);
      const unknownCount = unknownDomains ? unknownDomains.size : 0;

      // Sync badge with popup snapshot so numbers always match
      const count = aggregated.length;
      chrome.action.setBadgeText({ text: getBadgeCount(count), tabId });
      chrome.action.setBadgeBackgroundColor({ color: getBadgeColor(count), tabId });

      sendResponse({
        trackers: aggregated,
        domain: siteDomain,
        unknownCount,
        blockedCategories: prefs.blockedCategories,
      });
    });
    return true; // async response
  }

  if (message.type === 'contentScriptData') {
    // Content script reports cookies/storage/fingerprinting findings
    // Store alongside network-detected trackers for the tab
    // (future enhancement: merge content script findings into tracker list)
    return false;
  }

  if (message.type === 'toggleGPC') {
    prefs.gpcEnabled = message.enabled;
    if (prefs.gpcEnabled) {
      enableGPC();
    } else {
      disableGPC();
    }
    chrome.storage.local.set({ prefs });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'toggleCategory') {
    const { category, blocked } = message;
    if (blocked && !prefs.blockedCategories.includes(category)) {
      prefs.blockedCategories.push(category);
    } else if (!blocked) {
      prefs.blockedCategories = prefs.blockedCategories.filter(c => c !== category);
    }
    chrome.storage.local.set({ prefs });
    updateBlockingRules();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'clearSiteData') {
    const { domain } = message;
    chrome.browsingData.remove({
      origins: [`https://${domain}`, `http://${domain}`],
    }, {
      cookies: true,
      localStorage: true,
      sessionStorage: true,
      cache: true,
    }, () => {
      sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (message.type === 'getPrefs') {
    sendResponse({ prefs });
    return false;
  }

  if (message.type === 'blockTracker') {
    // Individual tracker block — add a dynamic rule for this specific domain
    const { domain, blocked } = message;
    const ruleId = 5000 + Math.abs(hashCode(domain)) % 4000;

    if (blocked) {
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: [{
          id: ruleId,
          priority: 3,
          action: { type: 'block' },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'other'],
          },
        }],
      });
    } else {
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: [],
      });
    }
    sendResponse({ ok: true });
    return false;
  }
});

// Check if a domain is whitelisted (exact match or subdomain of a whitelisted domain)
function isWhitelistedDomain(domain) {
  if (NON_TRACKING_DOMAINS.has(domain)) return true;
  // Check if it's a subdomain of a whitelisted domain
  for (const whitelisted of NON_TRACKING_DOMAINS) {
    if (domain.endsWith('.' + whitelisted)) return true;
  }
  return false;
}

// Simple string hash for generating rule IDs from domains
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
