// Stigma popup — fetches tracker data from background, renders UI, handles actions

document.addEventListener('DOMContentLoaded', async () => {
  const countNumber = document.getElementById('ego-count-number');
  const countLabel = document.getElementById('ego-count-label');
  const domainEl = document.getElementById('ego-domain');
  const trackerList = document.getElementById('ego-tracker-list');
  const emptyState = document.getElementById('ego-empty-state');
  const clearBtn = document.getElementById('ego-clear-data');
  const gpcBtn = document.getElementById('ego-gpc-btn');
  const categoryToggles = document.querySelectorAll('.ego-cat-toggle');
  const reloadBanner = document.getElementById('ego-reload-banner');
  const reloadBtn = document.getElementById('ego-reload-btn');
  const popup = document.getElementById('ego-popup');
  const infoPanel = document.getElementById('ego-info-panel');
  const infoContent = document.getElementById('ego-info-content');

  // --- Info Panel ---

  let activeInfo = null;

  const infoTexts = {
    categories: `
      <div class="ego-info-item"><strong class="cat-advertising">Advertising</strong> - Trackers that serve and measure ads. They follow you across sites to build a profile of your interests.</div>
      <div class="ego-info-item"><strong class="cat-analytics">Analytics</strong> - Scripts that measure how you use a site. They track clicks, scrolling, time on page, and your device.</div>
      <div class="ego-info-item"><strong class="cat-social">Social</strong> - Embedded widgets (like buttons, feeds, logins) that report your visits back to social platforms.</div>
      <div class="ego-info-item"><strong class="cat-fingerprinting">Fingerprinting</strong> - Scripts that identify your unique browser without cookies. The hardest tracking to stop.</div>
    `,
    gpc: `
      <div class="ego-info-item"><strong>Global Privacy Control</strong> - A signal sent with every page you visit, telling sites not to sell or share your data. Legally enforceable in California, Colorado, and a growing number of states. Like a universal "do not sell" switch for the entire web.</div>
    `,
    unknown: `
      <div class="ego-info-item"><strong>Unidentified requests</strong> - These are requests made to third-party domains that we can't yet match to a known tracker in our database. Some may be trackers we haven't catalogued yet, others may be harmless services like content delivery or payment processing. We're always expanding our database to identify more of these.</div>
    `,
  };

  function toggleInfo(key) {
    if (activeInfo === key) {
      infoPanel.classList.add('hidden');
      popup.classList.remove('info-open');
      activeInfo = null;
    } else {
      infoContent.innerHTML = infoTexts[key];
      infoPanel.classList.remove('hidden');
      popup.classList.add('info-open');
      activeInfo = key;
    }
  }

  document.querySelectorAll('.ego-info-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleInfo(btn.dataset.info));
  });

  // --- Load Data ---

  // Small delay to let any in-flight requests settle before taking a snapshot
  await new Promise(resolve => setTimeout(resolve, 300));

  const { trackers, domain, unknownCount, blockedCategories } = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getTrackers' }, resolve);
  });

  const { prefs } = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getPrefs' }, resolve);
  });

  // --- Reload Banner ---

  function showReloadBanner() {
    reloadBanner.classList.remove('hidden');
  }

  reloadBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id);
        window.close();
      }
    });
  });

  // --- Render Header ---

  domainEl.textContent = domain || 'unknown';

  const count = trackers.length;
  countNumber.textContent = count;
  countLabel.textContent = count === 1 ? 'tracker on this page' : 'trackers on this page';

  if (count <= 3) countNumber.className = 'severity-blue';
  else if (count <= 8) countNumber.className = 'severity-green';
  else if (count <= 15) countNumber.className = 'severity-yellow';
  else countNumber.className = 'severity-red';

  // --- Render Tracker List ---

  if (count === 0 && unknownCount === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');

    // Sort: advertising first, then social, fingerprinting, analytics
    const categoryOrder = { advertising: 0, social: 1, fingerprinting: 2, analytics: 3 };
    const sorted = [...trackers].sort((a, b) => {
      return (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99);
    });

    for (const tracker of sorted) {
      const entry = document.createElement('div');
      entry.className = 'ego-tracker-entry';

      const info = document.createElement('div');
      info.className = 'ego-tracker-info';

      // Company + product name
      const nameRow = document.createElement('div');
      const companySpan = document.createElement('span');
      companySpan.className = 'ego-tracker-company';
      companySpan.textContent = tracker.company;
      nameRow.appendChild(companySpan);

      if (tracker.product) {
        const productSpan = document.createElement('span');
        productSpan.className = 'ego-tracker-product';
        productSpan.textContent = tracker.product;
        nameRow.appendChild(productSpan);
      }
      info.appendChild(nameRow);

      // Data type tags — category label first, then data types
      const tags = document.createElement('div');
      tags.className = 'ego-tracker-tags';

      const catLabel = document.createElement('span');
      catLabel.className = `ego-category-label cat-${tracker.category}`;
      catLabel.textContent = tracker.category;
      tags.appendChild(catLabel);

      for (const dt of tracker.dataTypes) {
        const tag = document.createElement('span');
        tag.className = 'ego-data-tag';
        tag.textContent = dt;
        tags.appendChild(tag);
      }
      info.appendChild(tags);

      entry.appendChild(info);

      // Block/Unblock button
      const blockBtn = document.createElement('button');
      blockBtn.className = 'ego-block-btn';
      blockBtn.textContent = 'Block';

      blockBtn.addEventListener('click', () => {
        const isBlocked = blockBtn.classList.toggle('blocked');
        blockBtn.textContent = isBlocked ? 'Unblock' : 'Block';
        entry.classList.toggle('blocked', isBlocked);
        chrome.runtime.sendMessage({
          type: 'blockTracker',
          domain: tracker.domain,
          blocked: isBlocked,
        });
        showReloadBanner();
      });

      entry.appendChild(blockBtn);
      trackerList.appendChild(entry);
    }

    // Blocked categories line (shown when categories are actively blocked)
    if (blockedCategories && blockedCategories.length > 0) {
      const blockedLine = document.createElement('div');
      blockedLine.className = 'ego-blocked-summary';
      const catNames = blockedCategories.map(c => c.charAt(0).toUpperCase() + c.slice(1));
      blockedLine.textContent = `${catNames.join(', ')} trackers blocked and hidden`;
      trackerList.appendChild(blockedLine);
    }

    // Unknown third-party requests line
    if (unknownCount > 0) {
      const unknownLine = document.createElement('div');
      unknownLine.className = 'ego-unknown-trackers';

      const unknownText = document.createElement('span');
      unknownText.textContent = `+ ${unknownCount} additional third-party request${unknownCount === 1 ? '' : 's'} detected`;
      unknownLine.appendChild(unknownText);

      const unknownInfoBtn = document.createElement('button');
      unknownInfoBtn.className = 'ego-info-btn';
      unknownInfoBtn.dataset.info = 'unknown';
      unknownInfoBtn.textContent = '?';
      unknownInfoBtn.addEventListener('click', () => toggleInfo('unknown'));
      unknownLine.appendChild(unknownInfoBtn);

      trackerList.appendChild(unknownLine);
    }
  }

  // --- Category Toggles ---

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  categoryToggles.forEach((btn) => {
    const category = btn.dataset.category;
    const labelSpan = btn.querySelector('.ego-cat-label');

    function updateCategoryState(isActive) {
      labelSpan.textContent = isActive
        ? `Unblock ${capitalize(category)}`
        : `Block ${capitalize(category)}`;

      // Update visual state of matching tracker entries
      document.querySelectorAll(`.ego-category-label.cat-${category}`).forEach((label) => {
        const entry = label.closest('.ego-tracker-entry');
        if (entry) {
          entry.classList.toggle('blocked', isActive);
          const blockBtn = entry.querySelector('.ego-block-btn');
          if (blockBtn) {
            blockBtn.classList.toggle('blocked', isActive);
            blockBtn.textContent = isActive ? 'Unblock' : 'Block';
          }
        }
      });
    }

    if (prefs.blockedCategories.includes(category)) {
      btn.classList.add('active');
      updateCategoryState(true);
    }

    btn.addEventListener('click', () => {
      const isActive = btn.classList.toggle('active');
      chrome.runtime.sendMessage({
        type: 'toggleCategory',
        category,
        blocked: isActive,
      });
      updateCategoryState(isActive);
      showReloadBanner();
    });
  });

  // --- GPC Toggle ---

  if (prefs.gpcEnabled) {
    gpcBtn.classList.add('active');
    gpcBtn.textContent = 'GPC Opt-Out Active';
  } else {
    gpcBtn.textContent = 'Enable GPC Opt-Out';
  }

  gpcBtn.addEventListener('click', () => {
    const isActive = gpcBtn.classList.toggle('active');
    gpcBtn.textContent = isActive ? 'GPC Opt-Out Active' : 'Enable GPC Opt-Out';
    chrome.runtime.sendMessage({
      type: 'toggleGPC',
      enabled: isActive,
    });
    showReloadBanner();
  });

  // --- Clear Site Data ---

  clearBtn.addEventListener('click', () => {
    if (!domain) return;
    chrome.runtime.sendMessage({ type: 'clearSiteData', domain }, () => {
      clearBtn.textContent = 'Cleared!';
      clearBtn.classList.add('confirmed');
      setTimeout(() => {
        clearBtn.textContent = 'Clear Site Data';
        clearBtn.classList.remove('confirmed');
      }, 2000);
    });
  });
});
