// Stigma content script — reads cookies, storage, and detects fingerprinting

(function() {
  'use strict';

  const findings = {
    cookies: [],
    localStorageKeys: [],
    sessionStorageKeys: [],
    fingerprintingDetected: [],
  };

  // Read cookies accessible to this page
  try {
    const cookies = document.cookie.split(';').map(c => c.trim()).filter(Boolean);
    findings.cookies = cookies.map(c => {
      const [name] = c.split('=');
      return name.trim();
    });
  } catch (e) {
    // Cookies may be blocked
  }

  // Read localStorage keys
  try {
    findings.localStorageKeys = Object.keys(localStorage);
  } catch (e) {
    // May be blocked in some contexts
  }

  // Read sessionStorage keys
  try {
    findings.sessionStorageKeys = Object.keys(sessionStorage);
  } catch (e) {
    // May be blocked in some contexts
  }

  // Detect fingerprinting by monitoring API access
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  let canvasAccessed = false;

  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    if ((type === '2d' || type === 'webgl' || type === 'webgl2') && !canvasAccessed) {
      const ctx = originalGetContext.call(this, type, ...args);
      if (ctx && type === '2d') {
        const originalToDataURL = this.toDataURL;
        this.toDataURL = function(...toArgs) {
          canvasAccessed = true;
          findings.fingerprintingDetected.push('canvas');
          reportFindings();
          return originalToDataURL.apply(this, toArgs);
        };
      }
      return ctx;
    }
    return originalGetContext.call(this, type, ...args);
  };

  // Detect AudioContext fingerprinting
  const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OriginalAudioContext) {
    const originalCreateOscillator = OriginalAudioContext.prototype.createOscillator;
    OriginalAudioContext.prototype.createOscillator = function(...args) {
      if (!findings.fingerprintingDetected.includes('audio')) {
        findings.fingerprintingDetected.push('audio');
        reportFindings();
      }
      return originalCreateOscillator.apply(this, args);
    };
  }

  function reportFindings() {
    chrome.runtime.sendMessage({
      type: 'contentScriptData',
      data: findings,
    });
  }

  // Report initial findings after page loads
  if (document.readyState === 'complete') {
    reportFindings();
  } else {
    window.addEventListener('load', reportFindings);
  }
})();
