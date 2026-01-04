/**
 * Utility functions for filename manipulation
 * Used by the background service worker for processing download filenames
 */

/**
 * Sanitizes a filename by removing or replacing invalid characters
 * @param {string} filename - The filename to sanitize
 * @returns {string} The sanitized filename
 */
function sanitizeFilename(filename) {
  // Replace invalid characters (/, \, :, *, ?, ", <, >, |) with underscores
  return filename.replace(/[\/\\:*?"<>|]/g, '_');
}

/**
 * Extracts the domain from a URL
 * @param {string} url - The URL to extract the domain from
 * @returns {string} The extracted domain or 'unknown' if it can't be extracted
 */
function extractDomain(url) {
  try {
    // Create a URL object to easily parse the URL
    const urlObj = new URL(url);
    // Return just the hostname (e.g., example.com)
    return urlObj.hostname;
  } catch (error) {
    console.error('Error extracting domain:', error);
    return 'unknown';
  }
}

/**
 * Formats the current date as YYYYMMDD
 * @returns {string} The formatted date
 */
function getFormattedDate() {
  const now = new Date();
  const year = now.getFullYear();
  // Add leading zeros for month and day
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  return `${year}${month}${day}`;
}

/**
 * Formats the current time as HHMMSS
 * @returns {string} The formatted time
 */
function getFormattedTime() {
  const now = new Date();
  // Add leading zeros for hours, minutes, and seconds
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${hours}${minutes}${seconds}`;
}

/**
 * Formats the current timestamp as YYYYMMDD-HHMMSS
 * @returns {string} The formatted timestamp
 */
function getFormattedTimestamp() {
  return `${getFormattedDate()}-${getFormattedTime()}`;
}

/**
 * Splits a filename into name and extension parts
 * @param {string} filename - The filename to split
 * @returns {Object} Object containing {name, ext} properties
 */
function splitFilename(filename) {
  // Find the last occurrence of a dot
  const lastDotIndex = filename.lastIndexOf('.');
  
  // If there's no dot or it's at the start, consider the whole string as the name
  if (lastDotIndex <= 0) {
    return {
      name: filename,
      ext: ''
    };
  }
  
  // Split into name and extension
  return {
    name: filename.substring(0, lastDotIndex),
    ext: filename.substring(lastDotIndex) // Includes the dot
  };
}

/**
 * Processes a pattern string, replacing placeholders with actual values and joining with a separator.
 * @param {string} pattern - The pattern with placeholders like {date}{originalFilename} (separators are NOT in this string).
 * @param {Object} values - Object containing values for each placeholder (e.g., { date: '20230101', originalFilename: 'report'}).
 * @param {string} separator - The string to insert between replaced placeholder values.
 * @returns {string} The processed string with placeholders replaced and joined by the separator.
 */
function processPattern(pattern, values, separator) {
  // 1. Extract the ordered list of placeholders from the pattern string (excluding {ext})
  const placeholdersInPattern = (pattern.match(/\{([^}]+)\}/g) || [])
    .map(p => p.slice(1, -1)) // Extract name from {name}
    .filter(p => p !== 'ext'); // Exclude {ext}

  // 2. Get the corresponding value for each placeholder in the pattern's order
  const processedValues = placeholdersInPattern.map(ph => {
    const v = values[ph];
    return v !== undefined && v !== null ? String(v) : '';
  });

  // 3. Join the processed values using the specified separator
  // Filter out any potentially empty strings that might result from missing values 
  // before joining, unless the separator itself is empty.
  const joinedString = separator === '' 
      ? processedValues.join('') 
      : processedValues.filter(v => v !== '').join(separator);

  // 4. Append the {ext} value (which is passed in the `values` object)
  // Note: The pattern string itself doesn't contain {ext} anymore in this logic.
  const extension = values['ext'] || ''; // Get extension from values

  return joinedString + extension;
}

/**
 * Default comprehensive category rules for file types
 */
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

/**
 * Determines the category for a filename based on extension rules
 * @param {string} filename - The full filename (e.g., 'document.pdf')
 * @param {Array<object>} customRules - Optional custom category rules from user settings
 * @returns {string} The determined category name, or 'unknown' if no match
 */
function getCategoryForFile(filename, customRules = null) {
  const fallbackCategory = 'unknown';
  
  if (!filename) {
    return fallbackCategory;
  }

  // Extract the file extension
  const { ext } = splitFilename(filename);
  const extension = ext.startsWith('.') ? ext.substring(1).toLowerCase() : ext.toLowerCase();

  if (!extension) {
    return fallbackCategory;
  }

  // Use custom rules if provided, otherwise use defaults
  const rules = (customRules && Array.isArray(customRules) && customRules.length > 0) 
    ? customRules 
    : DEFAULT_CATEGORY_RULES;

  // Find matching category
  for (const rule of rules) {
    if (rule.name && rule.extensions) {
      const extensions = rule.extensions.split(',').map(e => e.trim().toLowerCase());
      if (extensions.includes(extension)) {
        return rule.name;
      }
    }
  }

  return fallbackCategory;
}

// Export functions for use in service-worker.js
export {
  sanitizeFilename,
  extractDomain,
  getFormattedDate,
  getFormattedTime,
  getFormattedTimestamp,
  splitFilename,
  getCategoryForFile,
  processPattern
}; 
