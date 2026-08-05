const fs = require('fs');
const path = require('path');

// Paths
const localesDir = path.join(__dirname, '../public/locales');
const enDir = path.join(localesDir, 'en');
const languagesConfigFile = path.join(__dirname, '../src/config/languages.ts');

function readSupportedLanguages() {
  const source = fs.readFileSync(languagesConfigFile, 'utf8');
  const match = source.match(/SUPPORTED_LANGUAGES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!match) {
    throw new Error(`Could not read SUPPORTED_LANGUAGES from ${languagesConfigFile}`);
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

// Expected languages from the app configuration (excluding 'en')
const expectedLanguages = readSupportedLanguages().filter((lang) => lang !== 'en');

// List of target languages (verify against expected)
const existingLanguages = fs
  .readdirSync(localesDir)
  .filter((lang) => lang !== 'en' && lang !== '.DS_Store');
const languages = expectedLanguages;

// Function to recursively check if all keys in the source object exist in the target object
function areKeysPresent(source, target) {
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      return false;
    }
    if (typeof source[key] === 'object' && source[key] !== null) {
      if (!areKeysPresent(source[key], target[key] || {})) {
        return false;
      }
    }
  }
  return true;
}

// Function to find missing keys recursively
function findMissingKeys(source, target, basePath = '') {
  const missingKeys = [];

  for (const key in source) {
    const currentPath = basePath ? `${basePath}.${key}` : key;

    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      missingKeys.push(currentPath);
    } else if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key])
    ) {
      const nestedMissing = findMissingKeys(source[key], target[key] || {}, currentPath);
      missingKeys.push(...nestedMissing);
    }
  }

  return missingKeys;
}

function collectPlaceholderIssues(source, target, basePath = '') {
  const issues = [];
  const placeholderPattern = /\{\{\s*([^{}\s]+)\s*\}\}/g;

  function placeholders(value) {
    return [...String(value).matchAll(placeholderPattern)].map((match) => match[1]).sort();
  }

  for (const key in source) {
    const currentPath = basePath ? `${basePath}.${key}` : key;
    const sourceValue = source[key];
    const targetValue = target?.[key];

    if (typeof sourceValue === 'string' && typeof targetValue === 'string') {
      const sourcePlaceholders = placeholders(sourceValue);
      const targetPlaceholders = placeholders(targetValue);
      const hasMalformedPlaceholder = targetValue.replace(placeholderPattern, '').includes('{{');

      if (
        hasMalformedPlaceholder ||
        sourcePlaceholders.length !== targetPlaceholders.length ||
        sourcePlaceholders.some((value, index) => value !== targetPlaceholders[index])
      ) {
        issues.push(currentPath);
      }
    } else if (
      sourceValue &&
      targetValue &&
      typeof sourceValue === 'object' &&
      typeof targetValue === 'object' &&
      !Array.isArray(sourceValue)
    ) {
      issues.push(...collectPlaceholderIssues(sourceValue, targetValue, currentPath));
    }
  }

  return issues;
}

// Main function to check keys
function checkKeys() {
  console.log('Starting localization verification...\n');

  // Check if all expected language directories exist
  console.log('Checking language directories:');
  const missingLanguages = [];
  for (const lang of expectedLanguages) {
    const langDir = path.join(localesDir, lang);
    if (fs.existsSync(langDir)) {
      console.log(`  ${lang} - directory exists`);
    } else {
      console.log(`  ${lang} - directory missing`);
      missingLanguages.push(lang);
    }
  }

  if (missingLanguages.length > 0) {
    console.error(`\nMissing language directories: ${missingLanguages.join(', ')}`);
    return false;
  }

  // Check for unexpected language directories
  const unexpectedLanguages = existingLanguages.filter((lang) => !expectedLanguages.includes(lang));
  if (unexpectedLanguages.length > 0) {
    console.log(`\nUnexpected language directories found: ${unexpectedLanguages.join(', ')}`);
  }

  console.log('\nChecking translation files:');

  // Filter out .DS_Store and non-JSON files in the 'en' directory
  const enFiles = fs
    .readdirSync(enDir)
    .filter((file) => path.extname(file) === '.json' && file !== '.DS_Store');

  console.log(`Found ${enFiles.length} JSON files in English directory\n`);

  let allKeysPresent = true;
  let totalIssues = 0;

  for (const file of enFiles) {
    console.log(`Checking ${file}:`);
    const enFilePath = path.join(enDir, file);
    const enContent = JSON.parse(fs.readFileSync(enFilePath, 'utf8'));

    for (const lang of languages) {
      const langFilePath = path.join(localesDir, lang, file);

      if (!fs.existsSync(langFilePath)) {
        console.log(`  ${lang}: File missing`);
        allKeysPresent = false;
        totalIssues++;
      } else {
        try {
          const langContent = JSON.parse(fs.readFileSync(langFilePath, 'utf8'));
          const missingKeys = findMissingKeys(enContent, langContent);
          const placeholderIssues = collectPlaceholderIssues(enContent, langContent);

          if (missingKeys.length > 0) {
            console.log(`  ${lang}: Missing ${missingKeys.length} keys`);
            console.log(
              `    Keys: ${missingKeys.slice(0, 5).join(', ')}${missingKeys.length > 5 ? '...' : ''}`,
            );
            allKeysPresent = false;
            totalIssues++;
          } else if (placeholderIssues.length > 0) {
            console.log(`  ${lang}: Placeholder mismatch in ${placeholderIssues.length} keys`);
            console.log(
              `    Keys: ${placeholderIssues.slice(0, 5).join(', ')}${placeholderIssues.length > 5 ? '...' : ''}`,
            );
            allKeysPresent = false;
            totalIssues++;
          } else {
            console.log(`  ${lang}: All keys present`);
          }
        } catch (error) {
          console.log(`  ${lang}: JSON parse error - ${error.message}`);
          allKeysPresent = false;
          totalIssues++;
        }
      }
    }
    console.log('');
  }

  console.log(`Verification Summary:`);
  console.log(`  Languages checked: ${expectedLanguages.length}`);
  console.log(`  Files per language: ${enFiles.length}`);
  console.log(`  Total checks: ${expectedLanguages.length * enFiles.length}`);
  console.log(`  Issues found: ${totalIssues}`);

  return allKeysPresent;
}

// Run the check
try {
  const result = checkKeys();

  if (result) {
    console.log('\nSUCCESS: All translation keys are present in all language files!');
    process.exit(0);
  } else {
    console.log(
      '\nFAILURE: Some translation keys are missing. Please run the localization script to fix missing translations.',
    );
    process.exit(1);
  }
} catch (error) {
  console.error('\nERROR:', error.message);
  process.exit(1);
}
