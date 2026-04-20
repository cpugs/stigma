import { extractDomain, lookupTracker, aggregateTrackers, getBadgeColor, getBadgeCount } from './lib/tracker-matcher.js';

// Per-tab tracker storage: tabId -> Map<domain, trackerInfo>
const tabTrackers = new Map();

// Per-tab unknown third-party domain count: tabId -> Set<domain>
const tabUnknownDomains = new Map();

// Per-tab timestamp of last top-level navigation start.
// Used to scope chrome.declarativeNetRequest.getMatchedRules() to the current page.
const tabLastNav = new Map();

// Reverse index: ruleId -> { domain, tracker, kind }
// Lets us translate getMatchedRules output back into tracker entries.
// kind: 'category' | 'individual'
const ruleIdMap = new Map();

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
  individualBlocks: [], // list of domains the user individually blocked
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
  // Defensive: ensure individualBlocks exists even on old stored prefs
  if (!Array.isArray(prefs.individualBlocks)) prefs.individualBlocks = [];

  // Set up GPC rules if enabled
  if (prefs.gpcEnabled) {
    enableGPC();
  }

  // Set up blocking rules for blocked categories + individual blocks
  updateBlockingRules();
  syncIndividualBlockRules();
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
      const isTrackingType = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping'].includes(details.type);
      if (isTrackingType && details.tabId >= 0) {
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
  tabLastNav.set(details.tabId, Date.now());
  updateBadge(details.tabId);
});

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  tabTrackers.delete(tabId);
  tabUnknownDomains.delete(tabId);
  tabLastNav.delete(tabId);
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

const INDIVIDUAL_RULE_BASE = 5000;
const INDIVIDUAL_RULE_BUCKETS = 4000;

function individualRuleId(domain) {
  return INDIVIDUAL_RULE_BASE + Math.abs(hashCode(domain)) % INDIVIDUAL_RULE_BUCKETS;
}

function updateBlockingRules() {
  const removeIds = [];
  const addRules = [];

  for (const [category, baseId] of Object.entries(CATEGORY_RULE_BASE)) {
    // Collect all domains in this category
    const domains = Object.entries(trackerDB)
      .filter(([, info]) => info.category === category)
      .map(([domain]) => domain);

    // Clear any prior ruleIdMap entries for this category's slots
    for (let i = 0; i < 500; i++) {
      removeIds.push(baseId + i);
      ruleIdMap.delete(baseId + i);
    }

    if (prefs.blockedCategories.includes(category)) {
      domains.forEach((domain, i) => {
        if (i >= 500) return;
        const ruleId = baseId + i;
        addRules.push({
          id: ruleId,
          priority: 2,
          action: { type: 'block' },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'other'],
          },
        });
        ruleIdMap.set(ruleId, {
          domain,
          tracker: { domain, ...trackerDB[domain] },
          kind: 'category',
        });
      });
    }
  }

  chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules });
}

// Re-create the dynamic rules + ruleIdMap entries for every domain in
// prefs.individualBlocks. Called at startup so in-memory state matches storage.
function syncIndividualBlockRules() {
  const addRules = [];
  const removeIds = [];

  for (const domain of prefs.individualBlocks) {
    const ruleId = individualRuleId(domain);
    removeIds.push(ruleId); // clear any stale rule at this slot first
    addRules.push({
      id: ruleId,
      priority: 3,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'other'],
      },
    });
    const dbEntry = trackerDB[domain];
    ruleIdMap.set(ruleId, {
      domain,
      tracker: dbEntry ? { domain, ...dbEntry } : null,
      kind: 'individual',
    });
  }

  if (addRules.length === 0 && removeIds.length === 0) return;
  chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules });
}

// --- Message Handling (from popup and content script) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getTrackers') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ trackers: [], domain: '', unknownCount: 0, blockedCategories: [] });
        return;
      }
      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url || '';
      const siteDomain = extractDomain(tabUrl) || '';

      // Detected trackers (requests that actually completed)
      const trackers = tabTrackers.get(tabId);
      const detectedMatches = trackers ? [...trackers.values()] : [];

      // Blocked-by-rule trackers: ask the browser which rules fired on this tab
      const blockedMatches = [];
      try {
        const minTimeStamp = tabLastNav.get(tabId) || 0;
        const res = await chrome.declarativeNetRequest.getMatchedRules({
          tabId,
          minTimeStamp,
        });
        const seen = new Set();
        for (const info of res.rulesMatchedInfo || []) {
          const entry = ruleIdMap.get(info.rule.ruleId);
          if (!entry || !entry.tracker) continue;
          if (seen.has(entry.domain)) continue;
          seen.add(entry.domain);
          blockedMatches.push(entry.tracker);
        }
      } catch (e) {
        // getMatchedRules may fail (e.g. tab closed). Fall back to detected-only.
      }

      // Merge + aggregate
      const aggregated = aggregateTrackers([...detectedMatches, ...blockedMatches]);

      // Mark each aggregated entry as blocked if its category is blocked,
      // or any of its domains is individually blocked.
      for (const t of aggregated) {
        const categoryBlocked = prefs.blockedCategories.includes(t.category);
        const individuallyBlocked = t.domains.some(d => prefs.individualBlocks.includes(d));
        t.blocked = categoryBlocked || individuallyBlocked;
      }

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
    return true;
  }

  if (message.type === 'getPrefs') {
    sendResponse({ prefs });
    return false;
  }

  if (message.type === 'blockTracker') {
    // Accepts { domains: [...], blocked } or legacy { domain, blocked }
    const domainList = Array.isArray(message.domains)
      ? message.domains
      : (message.domain ? [message.domain] : []);
    const { blocked } = message;

    const addRules = [];
    const removeIds = [];

    for (const domain of domainList) {
      const ruleId = individualRuleId(domain);
      removeIds.push(ruleId);

      if (blocked) {
        addRules.push({
          id: ruleId,
          priority: 3,
          action: { type: 'block' },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'other'],
          },
        });
        if (!prefs.individualBlocks.includes(domain)) {
          prefs.individualBlocks.push(domain);
        }
        const dbEntry = trackerDB[domain];
        ruleIdMap.set(ruleId, {
          domain,
          tracker: dbEntry ? { domain, ...dbEntry } : null,
          kind: 'individual',
        });
      } else {
        prefs.individualBlocks = prefs.individualBlocks.filter(d => d !== domain);
        ruleIdMap.delete(ruleId);
      }
    }

    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules });
    chrome.storage.local.set({ prefs });
    sendResponse({ ok: true });
    return false;
  }
});

// Check if a domain is whitelisted (exact match or subdomain of a whitelisted domain)
function isWhitelistedDomain(domain) {
  if (NON_TRACKING_DOMAINS.has(domain)) return true;
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
