/**
 * Options page script for the General Download Renamer extension
 * Handles drag-and-drop pattern building and settings persistence.
 */
document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const saveButton = document.getElementById('save-btn');
  const statusMessage = document.getElementById('status-message');
  const availableBlocksList = document.getElementById('available-blocks-list');
  const patternSequence = document.getElementById('pattern-sequence');
  const patternPreviewText = document.getElementById('pattern-preview-text');
  const placeholderText = patternSequence.querySelector('.placeholder-text');
  const placeholderDescriptionsList = document.querySelector('#placeholder-descriptions ul');
  const separatorSelect = document.getElementById('separator-select');
  const floatingIconToggle = document.getElementById('floating-icon-toggle');

  // Categories DOM elements
  const categoryRulesContainer = document.getElementById('category-rules-container');
  const addCategoryBtn = document.getElementById('add-category-btn');
  const resetCategoriesBtn = document.getElementById('reset-categories-btn');

  // --- Constants ---
  const DEFAULT_PATTERN = '{date}{originalFilename}{ext}';
  const DEFAULT_SEPARATOR = '_';
  // Built-in placeholders with their descriptions
  const BUILTIN_PLACEHOLDERS_INFO = {
    'domain': 'The domain name of the download source',
    'timestamp': 'Full date and time (YYYYMMDD-HHMMSS)',
    'date': 'Date only (YYYYMMDD)',
    'time': 'Time only (HHMMSS)',
    'originalFilename': 'The original filename without extension',
    'category': 'Auto-detected file category (Documents, Images, etc.)',
    'sourceUrl': 'Full download URL',
    'tabUrl': 'Referrer/tab URL when available'
  };
  const BUILTIN_PLACEHOLDERS = Object.keys(BUILTIN_PLACEHOLDERS_INFO);
  // Dynamic placeholders (built-in + custom)
  let PLACEHOLDERS_INFO = { ...BUILTIN_PLACEHOLDERS_INFO };
  let PLACEHOLDERS = Object.keys(PLACEHOLDERS_INFO);
  let currentlyDraggedItem = null;
  let currentSettings = { pattern: DEFAULT_PATTERN, separator: DEFAULT_SEPARATOR };
  const customPlaceholdersContainer = document.getElementById('custom-placeholders-container');
  const addCustomPlaceholderBtn = document.getElementById('add-custom-placeholder-btn');
  let currentCustomPlaceholders = [];

  // --- Functions ---

  /**
   * Creates a draggable placeholder block.
   * @param {string} placeholder - The placeholder name (e.g., 'date').
   * @param {boolean} isInSequence - If true, adds a remove button.
   * @returns {HTMLElement} The created block element.
   */
  function createBlock(placeholder, isInSequence = false) {
    const block = document.createElement('div');
    block.className = 'placeholder-block';
    block.textContent = `{${placeholder}}`;
    block.dataset.placeholder = placeholder;
    block.draggable = true;
    // block.title = PLACEHOLDERS_INFO[placeholder] || 'Placeholder block'; // Remove title tooltip

    block.addEventListener('dragstart', handleDragStart);
    block.addEventListener('dragend', handleDragEnd);

    if (isInSequence) {
      addRemoveButton(block);
      // Blocks in the sequence also need drop handling for reordering
      block.addEventListener('dragover', handleDragOverBlock);
      block.addEventListener('drop', handleDropOnBlock);
    }

    return block;
  }

  /**
   * Adds a remove button to a block in the sequence.
   * @param {HTMLElement} block - The block element.
   */
  function addRemoveButton(block) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-block-btn';
    removeBtn.innerHTML = '&times;'; // Use HTML entity for 'x'
    removeBtn.title = 'Remove block';
    removeBtn.addEventListener('click', () => {
      block.remove();
      updatePreview();
      checkPlaceholderVisibility();
      populateAvailableBlocks(); // Ensure this is called to repopulate available list
    });
    block.appendChild(removeBtn);
  }

  /**
   * Populates the list of available placeholder blocks, 
   * excluding any that are already in the current pattern sequence.
   */
  function populateAvailableBlocks() {
    availableBlocksList.innerHTML = ''; // Clear existing
    const sequencePlaceholders = Array.from(patternSequence.querySelectorAll('.placeholder-block'))
      .map(block => block.dataset.placeholder);

    PLACEHOLDERS.forEach(p => {
      // Only add if NOT already in the sequence
      if (!sequencePlaceholders.includes(p)) {
        const block = createBlock(p, false); // Create block without remove button for available list
        availableBlocksList.appendChild(block);
      }
    });
  }

  /**
   * Populates the placeholder descriptions list.
   */
  function populateDescriptions() {
    if (!placeholderDescriptionsList) return;
    placeholderDescriptionsList.innerHTML = ''; // Clear existing
    PLACEHOLDERS.forEach(p => {
      const li = document.createElement('li');
      const description = PLACEHOLDERS_INFO[p] || 'No description available.';
      li.innerHTML = `<code>{${p}}</code> - ${description}`;
      placeholderDescriptionsList.appendChild(li);
    });
  }

  /**
   * Loads custom placeholders from storage and updates dynamic placeholder lists
   */
  function loadCustomPlaceholdersAndUpdateLists(callback) {
    chrome.storage.local.get(['customPlaceholders'], (result) => {
      currentCustomPlaceholders = Array.isArray(result.customPlaceholders) ? result.customPlaceholders : [];
      PLACEHOLDERS_INFO = { ...BUILTIN_PLACEHOLDERS_INFO };
      currentCustomPlaceholders.forEach(cp => {
        if (cp && cp.name) {
          PLACEHOLDERS_INFO[cp.name] = `Custom derived from {${cp.base || 'unknown'}}`;
        }
      });
      PLACEHOLDERS = Object.keys(PLACEHOLDERS_INFO);
      if (typeof callback === 'function') callback();
    });
  }

  /**
   * Creates a custom placeholder rule element in the UI
   */
  function createCustomPlaceholderElement(rule, index) {
    const div = document.createElement('div');
    div.className = 'custom-placeholder-rule';
    div.dataset.index = index;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Name (e.g., productId)';
    nameInput.value = rule.name || '';

    const baseSelect = document.createElement('select');
    BUILTIN_PLACEHOLDERS.forEach(ph => {
      const opt = document.createElement('option');
      opt.value = ph;
      opt.textContent = `{${ph}}`;
      baseSelect.appendChild(opt);
    });
    baseSelect.value = rule.base || BUILTIN_PLACEHOLDERS[0];

    const regexInput = document.createElement('input');
    regexInput.type = 'text';
    regexInput.placeholder = 'Regex with one capture group';
    regexInput.value = rule.regex || '';

    const keywordsInput = document.createElement('input');
    keywordsInput.type = 'text';
    keywordsInput.placeholder = 'Keywords (comma-separated, optional)';
    keywordsInput.value = rule.keywords || '';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-custom-placeholder-btn';
    deleteBtn.textContent = 'Delete';

    function save() {
      saveCustomPlaceholders();
      // Update lists for builder/descriptions when names change
      loadCustomPlaceholdersAndUpdateLists(() => {
        populateAvailableBlocks();
        populateDescriptions();
      });
    }

    nameInput.addEventListener('input', save);
    baseSelect.addEventListener('change', save);
    regexInput.addEventListener('input', save);
    keywordsInput.addEventListener('input', save);
    deleteBtn.addEventListener('click', () => {
      div.remove();
      saveCustomPlaceholders();
      loadCustomPlaceholdersAndUpdateLists(() => {
        populateAvailableBlocks();
        populateDescriptions();
      });
    });

    div.appendChild(nameInput);
    div.appendChild(baseSelect);
    div.appendChild(regexInput);
    div.appendChild(keywordsInput);
    div.appendChild(deleteBtn);
    return div;
  }

  /**
   * Loads and renders custom placeholders in the options UI
   */
  function loadCustomPlaceholderRules() {
    chrome.storage.local.get(['customPlaceholders'], (result) => {
      const rules = Array.isArray(result.customPlaceholders) ? result.customPlaceholders : [];
      customPlaceholdersContainer.innerHTML = '';
      rules.forEach((rule, idx) => {
        const el = createCustomPlaceholderElement(rule, idx);
        customPlaceholdersContainer.appendChild(el);
      });
    });
  }

  /**
   * Saves current custom placeholders to storage
   */
  function saveCustomPlaceholders() {
    const rules = [];
    const ruleElements = customPlaceholdersContainer.querySelectorAll('.custom-placeholder-rule');
    ruleElements.forEach(el => {
      const inputs = el.querySelectorAll('input, select');
      const name = inputs[0].value.trim();
      const base = inputs[1].value;
      const regex = inputs[2].value.trim();
      const keywords = inputs[3].value.trim();
      if (name && base && regex) {
        rules.push({ name, base, regex, keywords });
      }
    });
    chrome.storage.local.set({ customPlaceholders: rules }, () => {
      // no-op
    });
  }

  /**
   * Adds a new custom placeholder row
   */
  function addNewCustomPlaceholder() {
    const rule = { name: '', base: BUILTIN_PLACEHOLDERS[0], regex: '', keywords: '' };
    const idx = customPlaceholdersContainer.children.length;
    const el = createCustomPlaceholderElement(rule, idx);
    customPlaceholdersContainer.appendChild(el);
    const nameInput = el.querySelector('input');
    if (nameInput) nameInput.focus();
  }

  /**
   * Loads settings from storage and populates the UI.
   */
  function loadSettings() {
    chrome.storage.local.get(['pattern', 'separator'], (result) => {
      currentSettings.pattern = result.pattern || DEFAULT_PATTERN;
      currentSettings.separator = result.separator !== undefined ? result.separator : DEFAULT_SEPARATOR;

      separatorSelect.value = currentSettings.separator;

      // Clear current sequence
      patternSequence.innerHTML = '';

      // Reconstruct sequence from saved pattern
      const savedPlaceholders = (currentSettings.pattern.match(/\{([^}]+)\}/g) || [])
        .map(p => p.slice(1, -1))
        .filter(p => p !== 'ext');

      savedPlaceholders.forEach(p => {
        if (PLACEHOLDERS.includes(p)) {
          const block = createBlock(p, true);
          patternSequence.appendChild(block);
        }
      });

      updatePreview();
      checkPlaceholderVisibility();

      // Populate available blocks *after* building the sequence
      populateAvailableBlocks();

      // Ensure all blocks loaded from settings have remove buttons
      ensureRemoveButtons();
    });
  }

  /**
   * Updates the preview text based on the current sequence and selected separator.
   */
  function updatePreview() {
    const blocks = Array.from(patternSequence.querySelectorAll('.placeholder-block'));
    const separator = separatorSelect.value;
    // Reconstruct preview from dataset to avoid including button text
    const preview = blocks
      .map(b => `{${b.dataset.placeholder}}`)
      .join(separator);
    patternPreviewText.textContent = preview;
  }

  /**
   * Shows/hides the 'Drop blocks here' placeholder text.
   */
  function checkPlaceholderVisibility() {
    if (patternSequence.querySelector('.placeholder-block')) {
      if (placeholderText) placeholderText.style.display = 'none';
    } else {
      if (!placeholderText) { // Create if it doesn't exist
        const span = document.createElement('span');
        span.className = 'placeholder-text';
        span.textContent = 'Drop blocks here';
        patternSequence.appendChild(span);
      } else {
        placeholderText.style.display = 'block';
      }
    }
  }

  /**
   * Saves the current settings (constructed pattern, separator).
   */
  function saveSettings() {
    const blocks = Array.from(patternSequence.querySelectorAll('.placeholder-block'));
    const patternPlaceholders = blocks.map(b => `{${b.dataset.placeholder}}`).join('');
    const finalPattern = patternPlaceholders + '{ext}';
    const separator = separatorSelect.value;

    chrome.storage.local.set({
      pattern: finalPattern,
      separator: separator
    }, () => {
      currentSettings.pattern = finalPattern;
      currentSettings.separator = separator;
      showStatusMessage('Settings saved!');
    });
  }

  /**
   * Displays a status message for a short duration.
   * @param {string} message - The message to display.
   */
  function showStatusMessage(message) {
    statusMessage.textContent = message;
    statusMessage.style.opacity = '1';
    setTimeout(() => { statusMessage.style.opacity = '0'; }, 2000);
  }

  // --- Drag and Drop Event Handlers ---

  function handleDragStart(e) {
    currentlyDraggedItem = e.target;
    e.dataTransfer.setData('text/plain', e.target.dataset.placeholder);
    e.target.classList.add('dragging');
    if (placeholderText) placeholderText.style.display = 'none'; // Hide placeholder during drag
  }

  function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    currentlyDraggedItem = null;
    checkPlaceholderVisibility(); // Show placeholder if sequence is empty
  }

  function handleDragOver(e) {
    e.preventDefault(); // Necessary to allow dropping
    patternSequence.classList.add('drag-over');
  }

  function handleDragLeave() {
    patternSequence.classList.remove('drag-over');
  }

  /**
   * Ensures all blocks in the pattern sequence have remove buttons.
   * Can be called after any drag/drop operation to fix inconsistencies.
   */
  function ensureRemoveButtons() {
    const sequenceBlocks = patternSequence.querySelectorAll('.placeholder-block');

    sequenceBlocks.forEach(block => {
      // Check if the block already has a remove button
      if (!block.querySelector('.remove-block-btn')) {
        addRemoveButton(block);

        // Also ensure the block has drag handling for reordering
        if (!block.hasAttribute('data-has-drop-handlers')) {
          block.addEventListener('dragover', handleDragOverBlock);
          block.addEventListener('drop', handleDropOnBlock);
          block.setAttribute('data-has-drop-handlers', 'true');
        }
      }
    });
  }

  function handleDropOnSequence(e) {
    e.preventDefault();
    patternSequence.classList.remove('drag-over');
    const placeholder = e.dataTransfer.getData('text/plain');

    // Ensure we have a valid placeholder and the dragged item exists
    if (!placeholder || !PLACEHOLDERS.includes(placeholder) || !currentlyDraggedItem) {
      return;
    }

    const sourceList = currentlyDraggedItem.parentNode;

    // Scenario 1: Dragging from Available list to Sequence container
    if (sourceList === availableBlocksList) {
      // Create a new block specifically for the sequence, with a remove button
      const newBlockInSequence = createBlock(placeholder, true);
      patternSequence.appendChild(newBlockInSequence);

      // Remove the original block that was dragged from the available list
      currentlyDraggedItem.remove();

      updatePreview();
      checkPlaceholderVisibility();
    }
    // Scenario 2: Reordering within Sequence (dropping onto the container itself, not another block)
    else if (sourceList === patternSequence) {
      // Just append the block being dragged (it should already have its remove button)
      patternSequence.appendChild(currentlyDraggedItem);
      updatePreview(); // Update preview after reorder
    }

    // Ensure all blocks in the sequence have remove buttons
    ensureRemoveButtons();
  }

  // Handlers for reordering *within* the sequence
  function handleDragOverBlock(e) {
    e.preventDefault();
    // Optional: add visual indication on the block being hovered over
  }

  function handleDropOnBlock(e) {
    e.preventDefault();
    e.stopPropagation(); // Prevent drop event bubbling to parent container

    if (!currentlyDraggedItem || currentlyDraggedItem === e.target) {
      return; // Can't drop on itself
    }

    // Insert the dragged item before the target item
    patternSequence.insertBefore(currentlyDraggedItem, e.target.closest('.placeholder-block'));
    updatePreview();

    // Ensure all blocks have remove buttons after reordering
    ensureRemoveButtons();
  }

  // --- Category Management Functions ---

  /**
   * Creates a DOM element for a single category rule
   * @param {Object} rule - The rule object with name and extensions
   * @param {number} index - The index for unique IDs
   */
  function createCategoryRuleElement(rule, index) {
    const ruleDiv = document.createElement('div');
    ruleDiv.className = 'category-rule';
    ruleDiv.dataset.index = index;

    // Category name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'category-name-input';
    nameInput.placeholder = 'Category Name (e.g., Documents)';
    nameInput.value = rule.name || '';
    nameInput.addEventListener('input', () => {
      validateAndSaveCategoryRules(nameInput);
    });

    // Extensions input
    const extensionsInput = document.createElement('input');
    extensionsInput.type = 'text';
    extensionsInput.className = 'category-extensions-input';
    extensionsInput.placeholder = 'Extensions (e.g., pdf, doc, docx)';
    extensionsInput.value = rule.extensions || '';
    extensionsInput.addEventListener('input', () => {
      validateAndSaveCategoryRules(extensionsInput);
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-category-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.title = 'Delete this category';
    deleteBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to delete this category?')) {
        ruleDiv.remove();
        saveCategoryRules();
      }
    });

    ruleDiv.appendChild(nameInput);
    ruleDiv.appendChild(extensionsInput);
    ruleDiv.appendChild(deleteBtn);

    return ruleDiv;
  }

  /**
   * Loads and displays all category rules from storage
   */
  function loadCategoryRules() {
    chrome.storage.local.get(['categoryRules'], (result) => {
      const rules = result.categoryRules || [];
      categoryRulesContainer.innerHTML = ''; // Clear existing

      rules.forEach((rule, index) => {
        const ruleElement = createCategoryRuleElement(rule, index);
        categoryRulesContainer.appendChild(ruleElement);
      });
    });
  }

  /**
   * Validates input and provides visual feedback
   * @param {HTMLElement} inputElement - The input element that changed
   */
  function validateAndSaveCategoryRules(inputElement) {
    // Remove any existing error styling
    inputElement.classList.remove('error');

    // Validate and save
    const isValid = validateCategoryInput(inputElement);
    if (!isValid) {
      inputElement.classList.add('error');
      // Don't save invalid data, but don't prevent typing
      return;
    }

    // Save if valid
    saveCategoryRules();
  }

  /**
   * Validates a category input field
   * @param {HTMLElement} inputElement - The input to validate
   * @returns {boolean} Whether the input is valid
   */
  function validateCategoryInput(inputElement) {
    const value = inputElement.value.trim();

    if (inputElement.classList.contains('category-name-input')) {
      // Category name validation
      if (value.length === 0) return true; // Allow empty while typing
      if (value.length < 2) return false; // Too short
      if (value.length > 50) return false; // Too long

      // Check for duplicate names
      const allNameInputs = categoryRulesContainer.querySelectorAll('.category-name-input');
      const duplicateCount = Array.from(allNameInputs).filter(input =>
        input !== inputElement && input.value.trim().toLowerCase() === value.toLowerCase()
      ).length;

      return duplicateCount === 0;
    } else if (inputElement.classList.contains('category-extensions-input')) {
      // Extensions validation
      if (value.length === 0) return true; // Allow empty while typing

      // Check format: comma-separated, no spaces around commas, no dots
      const extensionsRegex = /^[a-zA-Z0-9]+(,[a-zA-Z0-9]+)*$/;
      return extensionsRegex.test(value);
    }

    return true;
  }

  /**
   * Saves current category rules to storage
   */
  function saveCategoryRules() {
    const rules = [];
    const ruleElements = categoryRulesContainer.querySelectorAll('.category-rule');

    ruleElements.forEach(ruleEl => {
      const nameInput = ruleEl.querySelector('.category-name-input');
      const extensionsInput = ruleEl.querySelector('.category-extensions-input');

      const name = nameInput.value.trim();
      const extensions = extensionsInput.value.trim();

      // Only save rules that have both name and extensions
      if (name && extensions) {
        rules.push({ name, extensions });
      }
    });

    chrome.storage.local.set({ categoryRules: rules }, () => {
      console.log('Category rules saved:', rules.length, 'rules');
    });
  }

  /**
   * Adds a new empty category rule
   */
  function addNewCategory() {
    const newRule = { name: '', extensions: '' };
    const index = categoryRulesContainer.children.length;
    const ruleElement = createCategoryRuleElement(newRule, index);
    categoryRulesContainer.appendChild(ruleElement);

    // Focus on the name input for immediate editing
    const nameInput = ruleElement.querySelector('.category-name-input');
    nameInput.focus();
  }

  /**
   * Resets categories to default preset rules
   */
  function resetToDefaultCategories() {
    if (confirm('Are you sure you want to reset all categories to defaults? This will remove all your custom categories.')) {
      // Get default rules from background script constants
      const defaultRules = [
        { name: 'Documents', extensions: 'pdf,doc,docx,odt,rtf,txt,md' },
        { name: 'Spreadsheets', extensions: 'xls,xlsx,csv,ods,xml' },
        { name: 'Presentations', extensions: 'ppt,pptx,odp' },
        { name: 'Images', extensions: 'jpg,jpeg,png,gif,bmp,svg,webp,heic,heif' },
        { name: 'Design & RAW', extensions: 'psd,ai,eps,indd,sketch,fig,cr2,nef,arw,dng' },
        { name: 'Audio', extensions: 'mp3,wav,aac,flac,m4a,ogg' },
        { name: 'Videos', extensions: 'mp4,mov,avi,mkv,wmv,flv,webm' },
        { name: 'Archives', extensions: 'zip,rar,7z,tar,gz,bz2' },
        { name: 'Code', extensions: 'html,css,js,json,py,java,cpp,sh,ps1' },
        { name: 'Installers', extensions: 'exe,dmg,pkg,msi,deb,app' },
        { name: 'Fonts', extensions: 'ttf,otf,woff,woff2' }
      ];

      // Save defaults to storage
      chrome.storage.local.set({ categoryRules: defaultRules }, () => {
        // Reload the UI to show defaults
        loadCategoryRules();
        console.log('Categories reset to defaults');
      });
    }
  }

  // --- Floating Icon Toggle Functions ---

  /**
   * Loads the floating icon toggle state from storage
   */
  function loadFloatingIconToggle() {
    chrome.storage.local.get(['showFloatingIcon'], (result) => {
      const showFloatingIcon = result.showFloatingIcon !== undefined ? result.showFloatingIcon : true;
      floatingIconToggle.checked = showFloatingIcon;
    });
  }

  /**
   * Handles the floating icon toggle change
   * Storage change will automatically propagate to all tabs via their storage listeners
   */
  function handleFloatingIconToggle() {
    const showFloatingIcon = floatingIconToggle.checked;
    chrome.storage.local.set({ showFloatingIcon: showFloatingIcon }, () => {
      console.log('Floating icon visibility set to:', showFloatingIcon);
    });
  }

  /**
   * Handles storage changes from other sources (like the hide button in content scripts)
   */
  function handleOptionsStorageChange(changes, area) {
    if (area === 'local' && changes.showFloatingIcon !== undefined) {
      const newValue = changes.showFloatingIcon.newValue;
      if (floatingIconToggle && floatingIconToggle.checked !== newValue) {
        floatingIconToggle.checked = newValue;
        console.log('Floating icon toggle updated from storage:', newValue);
      }
    }
  }

  // --- Initialization ---
  loadCustomPlaceholdersAndUpdateLists(() => {
    populateAvailableBlocks();
    populateDescriptions();
    loadSettings();
  });
  saveButton.addEventListener('click', saveSettings);

  // Add drag listeners to the main drop zone
  patternSequence.addEventListener('dragover', handleDragOver);
  patternSequence.addEventListener('dragleave', handleDragLeave);
  patternSequence.addEventListener('drop', handleDropOnSequence);

  // Add change listener to the separator dropdown
  separatorSelect.addEventListener('change', updatePreview);

  // Initialize categories section
  loadCategoryRules();

  // Add event listener for adding new categories
  if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', addNewCategory);
  }

  // Add event listener for resetting categories
  if (resetCategoriesBtn) {
    resetCategoriesBtn.addEventListener('click', resetToDefaultCategories);
  }

  // Initialize custom placeholders section
  loadCustomPlaceholderRules();
  if (addCustomPlaceholderBtn) {
    addCustomPlaceholderBtn.addEventListener('click', addNewCustomPlaceholder);
  }

  // Initialize floating icon toggle
  loadFloatingIconToggle();
  if (floatingIconToggle) {
    floatingIconToggle.addEventListener('change', handleFloatingIconToggle);
  }

  // Listen for storage changes to keep toggle in sync with hide button clicks
  chrome.storage.onChanged.addListener(handleOptionsStorageChange);

}); 
