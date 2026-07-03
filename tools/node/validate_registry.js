#!/usr/bin/env node
/**
 * Registry validation for npm packages. Reads JSON from stdin, outputs JSON.
 * Uses only Node.js built-ins (https, fs, path).
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '.registry_cache.json');
const RATE_LIMIT_DELAY = 500; // 0.5s in milliseconds

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (_e) {
    // Ignore cache read errors
  }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch (_e) {
    // Best-effort cache persistence
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkNpmPackage(packageName) {
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const req = https.get(url, { headers: { 'User-Agent': 'patchwork-registry-validator/1.0' }, timeout: 10000 }, (res) => {
      // Consume the response body to free resources
      res.resume();
      if (res.statusCode === 200) {
        resolve({ package: packageName, exists: true });
      } else if (res.statusCode === 404) {
        resolve({ package: packageName, exists: false });
      } else {
        resolve({ package: packageName, exists: false, error: `HTTP error: ${res.statusCode}` });
      }
    });

    req.on('error', (err) => {
      resolve({ package: packageName, exists: false, error: `Network error: ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ package: packageName, exists: false, error: 'Network error: request timed out' });
    });
  });
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  raw = raw.trim();
  if (!raw) {
    console.log(JSON.stringify({ results: [], error: 'Empty input' }));
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.log(JSON.stringify({ results: [], error: `Invalid JSON: ${e.message}` }));
    return;
  }

  const packages = data.packages || [];
  const ecosystem = data.ecosystem || 'npm';

  if (ecosystem !== 'npm') {
    console.log(JSON.stringify({ results: [], error: `Unsupported ecosystem: ${ecosystem}` }));
    return;
  }

  const cache = loadCache();
  const results = [];

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const cacheKey = `npm:${pkg}`;

    if (cache[cacheKey]) {
      results.push(cache[cacheKey]);
    } else {
      const result = await checkNpmPackage(pkg);
      cache[cacheKey] = result;
      results.push(result);
      // Rate limit between requests (skip for last item)
      if (i < packages.length - 1) {
        await sleep(RATE_LIMIT_DELAY);
      }
    }
  }

  saveCache(cache);
  console.log(JSON.stringify({ results }));
}

main().catch((err) => {
  console.log(JSON.stringify({ results: [], error: `Script error: ${err.message}` }));
  process.exit(1);
});
