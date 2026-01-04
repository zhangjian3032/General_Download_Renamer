/**
 * Background service worker for the General Download Renamer extension
 * Handles download interception and renaming logic
 */

// Import utility functions
import {
  sanitizeFilename,
  extractDomain,
  getFormattedDate,
  getFormattedTime,
  getFormattedTimestamp,
  splitFilename,
  getCategoryForFile,
  processPattern
} from '../utils/filenameUtils.js';

// Default renaming pattern
const DEFAULT_PATTERN = '{date}{originalFilename}{ext}';
const DEFAULT_SEPARATOR = '_';

// Default category rules (will be used on first install)
const DEFAULT_CATEGORY_RULES = [
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

// Track the current state of the extension
let isEnabled = true;
let userPattern = DEFAULT_PATTERN;
let userSeparator = DEFAULT_SEPARATOR;
let categoryRules = []; // Will be loaded from storage
let customPlaceholders = []; // User-defined custom placeholders

// Initialize extension state from storage
chrome.storage.local.get(['enabled', 'pattern', 'separator', 'categoryRules', 'customPlaceholders'], (result) => {
  isEnabled = result.enabled !== undefined ? result.enabled : true;
  userPattern = result.pattern || DEFAULT_PATTERN;
  userSeparator = result.separator !== undefined ? result.separator : DEFAULT_SEPARATOR;

  // Load category rules (use defaults if none saved yet)
  if (result.categoryRules) {
    categoryRules = result.categoryRules;
  } else {
    // First time setup - save default rules to storage
    categoryRules = [...DEFAULT_CATEGORY_RULES];
    chrome.storage.local.set({ categoryRules: categoryRules });
  }

  // Load custom placeholders
  customPlaceholders = Array.isArray(result.customPlaceholders) ? result.customPlaceholders : [];

  console.log('Extension initialized:', {
    isEnabled,
    userPattern,
    userSeparator,
    categoryRulesCount: categoryRules.length,
    customPlaceholdersCount: customPlaceholders.length
  });
});

// Listen for storage changes to update settings dynamically
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled !== undefined) {
    isEnabled = changes.enabled.newValue;
    console.log('Extension enabled state changed:', isEnabled);
  }

  if (changes.pattern !== undefined) {
    userPattern = changes.pattern.newValue;
    console.log('Renaming pattern changed:', userPattern);
  }

  if (changes.separator !== undefined) {
    userSeparator = changes.separator.newValue;
    console.log('Separator changed:', userSeparator);
  }

  if (changes.categoryRules !== undefined) {
    categoryRules = changes.categoryRules.newValue;
    console.log('Category rules updated:', categoryRules.length, 'rules');
  }

  if (changes.customPlaceholders !== undefined) {
    customPlaceholders = Array.isArray(changes.customPlaceholders.newValue) ? changes.customPlaceholders.newValue : [];
    console.log('Custom placeholders updated:', customPlaceholders.length);
  }
});

/**
 * Processes a download and suggests a new filename based on the current pattern and separator
 * @param {Object} downloadItem - The Chrome download item object
 * @param {Function} suggest - Callback to suggest the new filename
 */
function processDownload(downloadItem, suggest) {
  // If extension is disabled, keep original filename
  if (!isEnabled) {
    suggest({ filename: downloadItem.filename });
    return;
  }

  try {
    // Get the original filename and split it
    const originalFilename = downloadItem.filename;
    const { name: nameWithoutExt, ext } = splitFilename(originalFilename);

    // Get download source URL and extract domain
    const sourceUrl = downloadItem.url || '';
    const domain = extractDomain(sourceUrl);

    // Get referrer/tab URL if available
    const tabUrl = downloadItem.referrer || '';

    // Get current date and time
    const date = getFormattedDate();
    const time = getFormattedTime();
    const timestamp = getFormattedTimestamp();

    // Determine file category using custom rules
    const category = getCategoryForFile(originalFilename, categoryRules);
    console.log(`File category determined: ${originalFilename} -> ${category} (using ${categoryRules.length} custom rules)`);

    // Create placeholder values object
    const placeholders = {
      domain: domain,
      timestamp: timestamp,
      date: date,
      time: time,
      originalFilename: nameWithoutExt,
      category: category,
      sourceUrl: sourceUrl,
      tabUrl: tabUrl,
      ext: ext
    };

    // Apply custom placeholders derived from existing placeholders
    if (Array.isArray(customPlaceholders) && customPlaceholders.length > 0) {
      for (const def of customPlaceholders) {
        const name = (def && def.name) ? String(def.name) : '';
        const from = (def && def.base) ? String(def.base) : '';
        const regexStr = (def && def.regex) ? String(def.regex) : '';
        const keywordsRaw = def && def.keywords !== undefined ? String(def.keywords) : '';

        if (!name || !from || !regexStr) {
          continue;
        }

        const sourceValue = placeholders[from] || '';
        if (!sourceValue) {
          placeholders[name] = '';
          continue;
        }

        // Keyword gating: if keywords provided, ensure at least one keyword appears
        const keywords = keywordsRaw
          .split(',')
          .map(k => k.trim())
          .filter(k => k.length > 0);

        const gatePass = keywords.length === 0
          ? true
          : keywords.some(k => sourceValue.toLowerCase().includes(k.toLowerCase()));

        if (!gatePass) {
          placeholders[name] = '';
          continue;
        }

        try {
          const re = new RegExp(regexStr);
          const m = sourceValue.match(re);
          placeholders[name] = (m && m[1]) ? String(m[1]) : '';
        } catch (e) {
          console.error('Invalid custom placeholder regex:', name, regexStr, e);
          placeholders[name] = '';
        }
      }
    }

    // Process the user's pattern, passing the separator
    let newFilename = processPattern(userPattern, placeholders, userSeparator);

    // Sanitize the new filename to remove invalid characters
    newFilename = sanitizeFilename(newFilename);

    console.log(`Renaming: ${originalFilename} -> ${newFilename}`);

    // Suggest the new filename
    suggest({ filename: newFilename });
  } catch (error) {
    console.error('Error processing download:', error);
    // In case of error, use the original filename
    suggest({ filename: downloadItem.filename });
  }
}

// Handle toolbar icon click - open options page
chrome.action.onClicked.addListener((tab) => {
  chrome.runtime.openOptionsPage();
});

// Listen for extension install or update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed or updated:', details.reason);

  // Set default settings if not already set
  chrome.storage.local.get(['enabled', 'pattern', 'separator'], (result) => {
    const settings = {};

    if (result.enabled === undefined) {
      settings.enabled = true;
    }

    if (!result.pattern) {
      settings.pattern = DEFAULT_PATTERN;
    }

    if (result.separator === undefined) {
      settings.separator = DEFAULT_SEPARATOR;
    }

    if (Object.keys(settings).length > 0) {
      chrome.storage.local.set(settings, () => {
        console.log('Default settings set:', settings);
      });
    }
  });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);

  if (message.action === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
  }

  // Always return true if you're sending a response asynchronously
  return true;
});

// Implement the download listener
chrome.downloads.onDeterminingFilename.addListener(processDownload);

// Log that the service worker has started
console.log('General Download Renamer service worker initialized'); 
