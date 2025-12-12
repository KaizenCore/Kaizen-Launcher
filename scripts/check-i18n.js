#!/usr/bin/env node

/**
 * i18n Integrity Checker
 * Compares all language files against English (en.json) as the base reference.
 * Reports missing keys, extra keys, and type mismatches.
 *
 * Usage: npm run i18n:check
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');
const BASE_LANG = 'en';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

/**
 * Recursively get all keys from an object with dot notation
 */
function getAllKeys(obj, prefix = '') {
  let keys = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      keys = keys.concat(getAllKeys(obj[key], fullKey));
    } else {
      keys.push({ key: fullKey, type: typeof obj[key] });
    }
  }
  return keys;
}

/**
 * Get value from object using dot notation key
 */
function getValue(obj, dotKey) {
  return dotKey.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, obj);
}

/**
 * Load all language files
 */
function loadLanguages() {
  const languages = {};
  const files = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const lang = file.replace('.json', '');
    const filePath = path.join(LOCALES_DIR, file);
    try {
      languages[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`${colors.red}Error loading ${file}: ${err.message}${colors.reset}`);
    }
  }

  return languages;
}

/**
 * Compare a language against the base language
 */
function compareLanguage(baseLang, baseData, targetLang, targetData) {
  const baseKeys = getAllKeys(baseData);
  const targetKeys = getAllKeys(targetData);

  const baseKeySet = new Set(baseKeys.map(k => k.key));
  const targetKeySet = new Set(targetKeys.map(k => k.key));

  const missing = [];
  const extra = [];
  const typeMismatch = [];
  const emptyValues = [];

  // Find missing keys in target
  for (const { key, type } of baseKeys) {
    if (!targetKeySet.has(key)) {
      missing.push(key);
    } else {
      // Check type mismatch
      const targetValue = getValue(targetData, key);
      const baseValue = getValue(baseData, key);
      if (typeof targetValue !== typeof baseValue) {
        typeMismatch.push({ key, expected: typeof baseValue, got: typeof targetValue });
      }
      // Check for empty strings
      if (typeof targetValue === 'string' && targetValue.trim() === '') {
        emptyValues.push(key);
      }
    }
  }

  // Find extra keys in target (not in base)
  for (const { key } of targetKeys) {
    if (!baseKeySet.has(key)) {
      extra.push(key);
    }
  }

  return { missing, extra, typeMismatch, emptyValues, total: baseKeys.length };
}

/**
 * Main function
 */
function main() {
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}                   i18n Integrity Checker${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}\n`);

  const languages = loadLanguages();

  if (!languages[BASE_LANG]) {
    console.error(`${colors.red}Base language file (${BASE_LANG}.json) not found!${colors.reset}`);
    process.exit(1);
  }

  const baseData = languages[BASE_LANG];
  const baseKeys = getAllKeys(baseData);

  console.log(`${colors.blue}Base language:${colors.reset} ${BASE_LANG}.json (${baseKeys.length} keys)\n`);

  const otherLangs = Object.keys(languages).filter(l => l !== BASE_LANG).sort();

  let hasErrors = false;
  const summary = [];

  for (const lang of otherLangs) {
    const result = compareLanguage(BASE_LANG, baseData, lang, languages[lang]);
    const targetKeys = getAllKeys(languages[lang]);

    const hasMissing = result.missing.length > 0;
    const hasExtra = result.extra.length > 0;
    const hasTypeMismatch = result.typeMismatch.length > 0;
    const hasEmpty = result.emptyValues.length > 0;
    const isOk = !hasMissing && !hasTypeMismatch;

    if (hasMissing || hasTypeMismatch) hasErrors = true;

    // Status icon
    const status = isOk
      ? `${colors.green}✓${colors.reset}`
      : `${colors.red}✗${colors.reset}`;

    console.log(`${status} ${colors.cyan}${lang}.json${colors.reset} (${targetKeys.length}/${baseKeys.length} keys)`);

    // Missing keys
    if (hasMissing) {
      console.log(`  ${colors.red}Missing (${result.missing.length}):${colors.reset}`);
      for (const key of result.missing.slice(0, 10)) {
        console.log(`    ${colors.dim}- ${key}${colors.reset}`);
      }
      if (result.missing.length > 10) {
        console.log(`    ${colors.dim}... and ${result.missing.length - 10} more${colors.reset}`);
      }
    }

    // Extra keys (warning, not error)
    if (hasExtra) {
      console.log(`  ${colors.yellow}Extra (${result.extra.length}):${colors.reset}`);
      for (const key of result.extra.slice(0, 5)) {
        console.log(`    ${colors.dim}- ${key}${colors.reset}`);
      }
      if (result.extra.length > 5) {
        console.log(`    ${colors.dim}... and ${result.extra.length - 5} more${colors.reset}`);
      }
    }

    // Type mismatches
    if (hasTypeMismatch) {
      console.log(`  ${colors.red}Type mismatches (${result.typeMismatch.length}):${colors.reset}`);
      for (const { key, expected, got } of result.typeMismatch) {
        console.log(`    ${colors.dim}- ${key}: expected ${expected}, got ${got}${colors.reset}`);
      }
    }

    // Empty values (warning)
    if (hasEmpty) {
      console.log(`  ${colors.yellow}Empty values (${result.emptyValues.length}):${colors.reset}`);
      for (const key of result.emptyValues.slice(0, 5)) {
        console.log(`    ${colors.dim}- ${key}${colors.reset}`);
      }
      if (result.emptyValues.length > 5) {
        console.log(`    ${colors.dim}... and ${result.emptyValues.length - 5} more${colors.reset}`);
      }
    }

    console.log('');

    summary.push({
      lang,
      keys: targetKeys.length,
      missing: result.missing.length,
      extra: result.extra.length,
      coverage: ((targetKeys.length - result.extra.length) / baseKeys.length * 100).toFixed(1)
    });
  }

  // Summary table
  console.log(`${colors.cyan}───────────────────────────────────────────────────────────${colors.reset}`);
  console.log(`${colors.cyan}                         Summary${colors.reset}`);
  console.log(`${colors.cyan}───────────────────────────────────────────────────────────${colors.reset}\n`);

  console.log(`  ${'Lang'.padEnd(8)} ${'Keys'.padStart(6)} ${'Missing'.padStart(9)} ${'Extra'.padStart(7)} ${'Coverage'.padStart(10)}`);
  console.log(`  ${'-'.repeat(8)} ${'-'.repeat(6)} ${'-'.repeat(9)} ${'-'.repeat(7)} ${'-'.repeat(10)}`);

  for (const s of summary) {
    const missingColor = s.missing > 0 ? colors.red : colors.green;
    const coverageColor = parseFloat(s.coverage) === 100 ? colors.green : colors.yellow;

    console.log(`  ${s.lang.padEnd(8)} ${String(s.keys).padStart(6)} ${missingColor}${String(s.missing).padStart(9)}${colors.reset} ${String(s.extra).padStart(7)} ${coverageColor}${(s.coverage + '%').padStart(10)}${colors.reset}`);
  }

  console.log('');

  if (hasErrors) {
    console.log(`${colors.red}Some languages have missing keys or type mismatches.${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}All languages are complete!${colors.reset}\n`);
    process.exit(0);
  }
}

main();
