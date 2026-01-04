/**
 * Content script for the Download Renamer floating icon.
 */

(() => {
  // --- Constants and State ---
  const ICON_ID = 'dr-floating-icon';
  const POPUP_ID = 'dr-popup-panel';
  const DEFAULT_PATTERN = '{date}_{originalFilename}{ext}';
  let floatingIcon = null;
  let popupPanel = null;
  let isDragging = false;
  let offsetX, offsetY;
  let currentSettings = { enabled: true, pattern: DEFAULT_PATTERN };

  // --- Core Functions ---

  /**
   * Creates and injects the floating icon element.
   */
  function createIcon() {
    if (document.getElementById(ICON_ID)) return; // Already exists

    floatingIcon = document.createElement('div');
    floatingIcon.id = ICON_ID;
    floatingIcon.title = 'Download Renamer (Click for menu, drag to move)';

    const iconImage = document.createElement('img');
    iconImage.id = 'dr-floating-icon-img';
    try {
      iconImage.src = chrome.runtime.getURL('icons/icon48.png');
    } catch (error) {
      console.error('[DR Icon] Error getting icon URL:', error);
      // Don't proceed if icon URL fails (likely invalid context)
      return;
    }
    iconImage.alt = 'DR';

    // Create hide button
    const hideButton = document.createElement('button');
    hideButton.id = 'dr-hide-button';
    hideButton.className = 'dr-hide-btn';
    hideButton.innerHTML = '×';
    hideButton.title = 'Hide floating icon';
    hideButton.setAttribute('aria-label', 'Hide floating icon');

    floatingIcon.appendChild(iconImage);
    floatingIcon.appendChild(hideButton);
    document.body.appendChild(floatingIcon);

    updateIconAppearance();
    setupDraggable();
    setupClickHandlers();
  }

  /**
   * Creates the popup panel element (initially hidden).
   */
  function createPopup() {
    if (document.getElementById(POPUP_ID)) return;

    popupPanel = document.createElement('div');
    popupPanel.id = POPUP_ID;
    document.body.appendChild(popupPanel);
  }

  /**
   * Fetches settings and updates the popup's content and visibility.
   */
  function showPopup() {
    if (!popupPanel || !floatingIcon) return;

    // Fetch pattern AND separator
    chrome.storage.local.get(['enabled', 'pattern', 'separator', 'customPlaceholders'], (result) => {
      currentSettings.enabled = result.enabled !== undefined ? result.enabled : true;
      currentSettings.pattern = result.pattern || DEFAULT_PATTERN;
      // Use underscore as default separator if none is saved
      currentSettings.separator = result.separator !== undefined ? result.separator : '_';

      // --- Construct Preview String ---
      const placeholdersInPattern = (currentSettings.pattern.match(/\{([^}]+)\}/g) || [])
        .map(p => p.slice(1, -1)) // Extract name from {name}
        .filter(p => p !== 'ext'); // Exclude {ext}
      const previewString = placeholdersInPattern
        .map(p => `{${p}}`)
        .join(currentSettings.separator);
      const currentPatternDisplay = previewString;
      const now = new Date();
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const timestamp = `${date}-${time}`;
      const tabUrl = window.location && window.location.href ? window.location.href : '';
      const domain = window.location && window.location.hostname ? window.location.hostname : 'unknown';
      const baseValues = { domain, date, time, timestamp, tabUrl };
      const customDefs = Array.isArray(result.customPlaceholders) ? result.customPlaceholders : [];
      const resolvedValues = { ...baseValues };
      if (customDefs.length > 0) {
        customDefs.forEach(def => {
          const name = def && def.name ? String(def.name) : '';
          const from = def && def.base ? String(def.base) : '';
          const regexStr = def && def.regex ? String(def.regex) : '';
          const keywordsRaw = def && def.keywords !== undefined ? String(def.keywords) : '';
          if (!name || !from || !regexStr) return;
          const sourceValue = resolvedValues[from] || '';
          const keywords = keywordsRaw.split(',').map(k => k.trim()).filter(k => k.length > 0);
          const gatePass = keywords.length === 0 ? true : keywords.some(k => sourceValue.toLowerCase().includes(k.toLowerCase()));
          if (!gatePass) return;
          try {
            const re = new RegExp(regexStr);
            const m = sourceValue.match(re);
            if (m && m[1]) resolvedValues[name] = String(m[1]);
          } catch (_) { }
        });
      }
      const previewResolvedString = placeholdersInPattern
        .map(p => {
          const v = resolvedValues[p];
          return v !== undefined && v !== null && String(v).length > 0 ? String(v) : `{${p}}`;
        })
        .join(currentSettings.separator);

      // Build popup HTML
      popupPanel.innerHTML = `
        <h3>Download Renamer</h3>
        <div class="dr-toggle-container">
          <label class="dr-toggle-label">
            <span>Enable Renaming</span>
            <div class="dr-toggle-switch">
              <input type="checkbox" id="dr-popup-enabled" ${currentSettings.enabled ? 'checked' : ''}>
              <span class="dr-toggle-slider"></span>
            </div>
          </label>
        </div>
        <div class="dr-button-container">
          <button id="dr-popup-options-btn" class="dr-button">Options</button>
        </div>
        <div class="dr-footer">
          Current pattern:
          <span class="dr-current-pattern">${escapeHtml(currentPatternDisplay)}<code>.{ext}</code></span>
          <br>
          Preview pattern:
          <span class="dr-current-pattern">${escapeHtml(previewResolvedString)}<code>.{ext}</code></span>
        </div>
      `;

      // Add event listeners *after* innerHTML is set
      addPopupEventListeners();

      // Position and show
      positionPopup();
      popupPanel.classList.add('visible');
    });
  }

  /**
   * Hides the popup panel.
   */
  function hidePopup() {
    if (popupPanel) {
      popupPanel.classList.remove('visible');
      // Optional: Remove content after fade-out? 
      // setTimeout(() => { popupPanel.innerHTML = ''; }, 200);
    }
  }

  /**
   * Adds event listeners to elements inside the popup.
   */
  function addPopupEventListeners() {
    const toggle = popupPanel.querySelector('#dr-popup-enabled');
    const optionsBtn = popupPanel.querySelector('#dr-popup-options-btn');

    if (toggle) {
      toggle.addEventListener('change', handleToggleChange);
    }
    if (optionsBtn) {
      optionsBtn.addEventListener('click', handleOptionsClick);
    }
  }

  /**
   * Handles the enable/disable toggle change.
   * @param {Event} event - The change event.
   */
  function handleToggleChange(event) {
    const isEnabled = event.target.checked;
    chrome.storage.local.set({ enabled: isEnabled });
    // No need to call updateIconAppearance, storage listener will handle it
  }

  /**
   * Handles the click on the options button.
   */
  function handleOptionsClick() {
    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
    hidePopup();
  }

  /**
   * Positions the popup relative to the floating icon.
   */
  function positionPopup() {
    if (!popupPanel || !floatingIcon) return;

    const margin = 12;
    const iconRect = floatingIcon.getBoundingClientRect();

    const computed = window.getComputedStyle(popupPanel);
    let restoreHidden = false;
    if (computed.display === 'none') {
      popupPanel.style.visibility = 'hidden';
      popupPanel.style.display = 'block';
      restoreHidden = true;
    }

    const panelRect = popupPanel.getBoundingClientRect();
    const panelWidth = panelRect.width || 340;
    const panelHeight = panelRect.height || 200;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const centeredLeft = iconRect.left + (iconRect.width / 2) - (panelWidth / 2);
    let left = Math.min(Math.max(centeredLeft, margin), viewportWidth - panelWidth - margin);

    const aboveTop = iconRect.top - panelHeight - margin;
    const belowTop = iconRect.bottom + margin;
    let top = aboveTop >= margin ? aboveTop : belowTop;
    top = Math.min(Math.max(top, margin), viewportHeight - panelHeight - margin);

    popupPanel.style.top = `${top}px`;
    popupPanel.style.left = `${left}px`;

    if (restoreHidden) {
      popupPanel.style.visibility = '';
      popupPanel.style.display = '';
    }
  }

  /**
   * Updates the icon's appearance based on the enabled state.
   * (Adds/removes .active/.inactive classes)
   */
  function updateIconAppearance() {
    if (!floatingIcon) return;

    if (currentSettings.enabled) {
      floatingIcon.classList.add('active');
      floatingIcon.classList.remove('inactive');
      // Ensure opacity is set correctly if transitioning from inactive
      // floatingIcon.style.opacity = '1'; 
    } else {
      floatingIcon.classList.add('inactive');
      floatingIcon.classList.remove('active');
      // Ensure opacity is set correctly if transitioning from active
      // floatingIcon.style.opacity = '0.65'; 
    }
    // Opacity is now handled by the CSS classes, so direct style manipulation is removed.
  }

  /**
   * Sets up dragging functionality for the icon.
   */
  function setupDraggable() {
    if (!floatingIcon) return;

    floatingIcon.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only main button
      isDragging = true;
      offsetX = e.clientX - floatingIcon.getBoundingClientRect().left;
      offsetY = e.clientY - floatingIcon.getBoundingClientRect().top;
      floatingIcon.style.transition = 'none'; // Disable transition during drag
      document.addEventListener('mousemove', handleDrag);
      document.addEventListener('mouseup', stopDrag, { once: true }); // Use once
      e.preventDefault(); // Prevent text selection
    });

    function handleDrag(e) {
      if (!isDragging) return;
      // Calculate new position within viewport bounds
      const x = Math.min(
        window.innerWidth - floatingIcon.offsetWidth,
        Math.max(0, e.clientX - offsetX)
      );
      const y = Math.min(
        window.innerHeight - floatingIcon.offsetHeight,
        Math.max(0, e.clientY - offsetY)
      );
      floatingIcon.style.left = `${x}px`;
      floatingIcon.style.top = `${y}px`;
      // Overwrite fixed bottom/right positioning
      floatingIcon.style.bottom = 'auto';
      floatingIcon.style.right = 'auto';
    }

    function stopDrag() {
      if (isDragging) {
        isDragging = false;
        floatingIcon.style.transition = 'transform 0.2s ease-out'; // Re-enable transition
        document.removeEventListener('mousemove', handleDrag);
      }
    }
  }

  /**
   * Hides the floating icon with animation and saves state.
   * Hides the icon in all open tabs and prevents it from appearing in new tabs.
   */
  function hideFloatingIcon() {
    if (!floatingIcon) return;

    // Hide popup first if visible
    hidePopup();

    // Animate out
    floatingIcon.style.transform = 'scale(0)';
    floatingIcon.style.opacity = '0';

    // Remove from DOM after animation
    setTimeout(() => {
      if (floatingIcon && floatingIcon.parentNode) {
        floatingIcon.parentNode.removeChild(floatingIcon);
        floatingIcon = null;
      }
    }, 200);

    // Save hidden state to storage (persists across page loads and new tabs)
    // The storage change will automatically propagate to all tabs via their storage listeners
    chrome.storage.local.set({ showFloatingIcon: false }, () => {
      console.log('[DR Icon] Icon hidden by user globally');
    });
  }

  /**
   * Sets up click handlers for the icon and document.
   */
  function setupClickHandlers() {
    if (!floatingIcon) return;

    // Need a flag to distinguish drag from click
    let dragHappened = false;
    floatingIcon.addEventListener('mousedown', () => { dragHappened = false; });
    floatingIcon.addEventListener('mousemove', () => { if (isDragging) dragHappened = true; });

    // Hide button click handler
    const hideButton = floatingIcon.querySelector('#dr-hide-button');
    if (hideButton) {
      hideButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        hideFloatingIcon();
      });
    }

    // Left click on main icon (but not hide button)
    floatingIcon.addEventListener('click', (e) => {
      // Don't trigger if clicking hide button
      if (e.target.id === 'dr-hide-button') return;

      if (dragHappened) return; // Don't trigger click after drag
      e.stopPropagation();
      if (popupPanel && popupPanel.classList.contains('visible')) {
        hidePopup();
      } else {
        showPopup();
      }
    });

    // Right click
    floatingIcon.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Does nothing as requested
    });

    // Hide popup when clicking outside
    document.addEventListener('click', (e) => {
      if (popupPanel && popupPanel.classList.contains('visible')) {
        if (!popupPanel.contains(e.target) && e.target !== floatingIcon) {
          hidePopup();
        }
      }
    });
  }

  /**
   * Loads initial settings from storage.
   */
  function loadInitialSettings() {
    chrome.storage.local.get(['enabled', 'pattern'], (result) => {
      currentSettings.enabled = result.enabled !== undefined ? result.enabled : true;
      currentSettings.pattern = result.pattern || DEFAULT_PATTERN;
      updateIconAppearance();
    });
  }

  /**
   * Handles changes in chrome.storage.
   */
  function handleStorageChange(changes, area) {
    if (area === 'local') {
      let changed = false;
      if (changes.enabled !== undefined) {
        currentSettings.enabled = changes.enabled.newValue;
        changed = true;
      }
      if (changes.pattern !== undefined) {
        currentSettings.pattern = changes.pattern.newValue;
        // No visual change needed on icon for pattern change
      }
      // Handle showFloatingIcon changes for real-time sync across tabs
      if (changes.showFloatingIcon !== undefined) {
        const shouldShow = changes.showFloatingIcon.newValue;
        if (shouldShow && !floatingIcon) {
          // Show icon when toggled on from options page
          createIcon();
          if (!popupPanel) createPopup();
          loadInitialSettings();
        } else if (!shouldShow && floatingIcon) {
          // Hide icon when toggled off from options page or hide button
          hidePopup();
          floatingIcon.style.transform = 'scale(0)';
          floatingIcon.style.opacity = '0';
          setTimeout(() => {
            if (floatingIcon && floatingIcon.parentNode) {
              floatingIcon.parentNode.removeChild(floatingIcon);
              floatingIcon = null;
            }
          }, 200);
        }
        return; // Don't need to update icon appearance for visibility changes
      }
      if (changed) {
        updateIconAppearance();
        // If popup is visible, update its content
        if (popupPanel && popupPanel.classList.contains('visible')) {
          // Rebuild content to reflect change
          showPopup();
        }
      }
    }
  }

  /**
  * Simple HTML escaping
  */
  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // --- Message Handling ---

  /**
   * Handles messages from popup/background scripts
   */
  function handleMessage(message, sender, sendResponse) {
    if (message.action === 'showFloatingIcon') {
      if (!floatingIcon) {
        createIcon();
        if (!popupPanel) createPopup();
        loadInitialSettings();
      }
    } else if (message.action === 'hideFloatingIcon') {
      hideFloatingIcon();
    }
  }

  // --- Initialization ---

  /**
   * Initializes the floating icon and popup.
   */
  function initialize() {
    // Avoid running multiple times
    if (document.getElementById(ICON_ID)) {
      console.log('[DR Icon] Already initialized.');
      return;
    }

    console.log('[DR Icon] Initializing...');

    // Check if floating icon should be shown (default: true)
    chrome.storage.local.get(['showFloatingIcon'], (result) => {
      const showFloatingIcon = result.showFloatingIcon !== undefined ? result.showFloatingIcon : true;

      if (showFloatingIcon) {
        createIcon();
        createPopup();
        loadInitialSettings();
      }
    });

    // Listen for storage changes
    chrome.storage.onChanged.addListener(handleStorageChange);

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // Run initialization
  // Use a timeout to avoid potential race conditions on complex pages
  // or conflicts with other scripts during initial load.
  setTimeout(initialize, 500);

})(); // IIFE to avoid polluting global scope 
