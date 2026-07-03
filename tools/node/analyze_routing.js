#!/usr/bin/env node
/**
 * Regex-based routing/middleware analysis for Express/Node.js code.
 * Reads raw JavaScript/TypeScript code from stdin, outputs JSON to stdout.
 *
 * Detects:
 * - app.use(...), router.get(...), router.post(...), etc.
 * - Middleware chain analysis: app.get('/path', authMiddleware, handler)
 * - Routes without auth middleware when siblings have it
 *
 * Uses only Node.js built-ins.
 */
'use strict';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'];

// Hints that a middleware name is auth-related
const AUTH_HINTS = [
  'auth', 'login', 'token', 'session', 'jwt', 'passport',
  'verify', 'protect', 'guard', 'permission', 'require',
  'authenticate', 'isAuthenticated', 'isLoggedIn', 'ensureAuth',
];

function isAuthMiddleware(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return AUTH_HINTS.some(function (hint) { return lower.includes(hint); });
}

function analyzeRouting(code) {
  var routes = [];
  var middleware = [];
  var errors = [];

  var lines = code.split('\n');

  // ---------- Pattern 1: route definitions ----------
  // Match: app.get('/path', ...) or router.post('/path', ...) etc.
  // Also matches: app.route('/path').get(handler)
  var routeRegex = new RegExp(
    '(?:app|router|route|server)\\s*\\.\\s*(' + HTTP_METHODS.join('|') + ')\\s*\\(' +
    '\\s*[\'"`]([^\'"`]+)[\'"`]' +     // path string
    '(?:\\s*,\\s*([^)]+))?\\)',         // optional remaining args (middleware + handler)
    'g'
  );

  var match;
  while ((match = routeRegex.exec(code)) !== null) {
    var method = (match[1] || 'get').toUpperCase();
    var routePath = match[2] || '<unknown>';
    var argsStr = match[3] || '';
    var lineNum = code.substring(0, match.index).split('\n').length;

    // Parse the arguments to find middleware vs handler
    var guards = [];
    var hasAuth = false;

    // Split remaining args by comma, trim, and check each
    var argParts = argsStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    // Last arg is typically the handler; everything before is middleware
    if (argParts.length > 1) {
      var middlewareArgs = argParts.slice(0, -1);
      for (var i = 0; i < middlewareArgs.length; i++) {
        var mwName = middlewareArgs[i].replace(/\(.*\)/, '').trim();
        guards.push(mwName);
        if (isAuthMiddleware(mwName)) {
          hasAuth = true;
        }
      }
    }

    routes.push({
      path: routePath,
      method: method,
      file: '<stdin>',
      line: lineNum,
      guards: guards,
      has_auth: hasAuth,
    });
  }

  // ---------- Pattern 2: app.use() middleware ----------
  var useRegex = /(?:app|router|server)\s*\.\s*use\s*\(\s*([^)]+)\)/g;
  while ((match = useRegex.exec(code)) !== null) {
    var useArgs = match[1] || '';
    var useLine = code.substring(0, match.index).split('\n').length;

    // app.use('/path', middleware) or app.use(middleware)
    var parts = useArgs.split(',').map(function (s) { return s.trim(); });
    var mwPath = null;
    var mwNames = [];

    for (var j = 0; j < parts.length; j++) {
      var part = parts[j];
      // Check if it's a path string
      if (/^['"`]/.test(part)) {
        mwPath = part.replace(/['"`]/g, '');
      } else {
        // It's a middleware reference
        var name = part.replace(/\(.*\)/, '').trim();
        if (name) {
          mwNames.push(name);
        }
      }
    }

    for (var k = 0; k < mwNames.length; k++) {
      middleware.push({
        name: mwNames[k],
        line: useLine,
        type: 'app_use',
        path: mwPath,
      });
    }
  }

  // ---------- Pattern 3: require/import of common middleware ----------
  // e.g., const helmet = require('helmet');
  var requireRegex = /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = requireRegex.exec(code)) !== null) {
    var varName = match[1];
    var modName = match[2];
    var reqLine = code.substring(0, match.index).split('\n').length;

    // Check if this module is commonly used as middleware
    var commonMiddleware = [
      'cors', 'helmet', 'morgan', 'compression', 'cookie-parser',
      'body-parser', 'express-session', 'passport', 'express-rate-limit',
    ];
    if (commonMiddleware.indexOf(modName) !== -1) {
      middleware.push({
        name: varName,
        line: reqLine,
        type: 'require_middleware',
        module: modName,
      });
    }
  }

  // ---------- Compute unguarded routes ----------
  var unguarded = findUnguardedRoutes(routes);

  return {
    routes: routes,
    middleware: middleware,
    unguarded_routes: unguarded,
    errors: errors,
  };
}

function findUnguardedRoutes(routes) {
  if (routes.length < 2) return [];

  var guardedCount = 0;
  for (var i = 0; i < routes.length; i++) {
    if (routes[i].has_auth) guardedCount++;
  }

  // Only flag if majority of routes are guarded
  if (guardedCount <= routes.length / 2) return [];

  var unguarded = [];
  for (var j = 0; j < routes.length; j++) {
    var r = routes[j];
    if (!r.has_auth) {
      unguarded.push({
        path: r.path,
        line: r.line,
        reason: 'No auth middleware while ' + guardedCount + '/' + routes.length +
                ' sibling routes use auth middleware',
      });
    }
  }

  return unguarded;
}

// ---- Main: read stdin, analyse, write JSON to stdout ----
async function main() {
  var raw = '';
  for await (var chunk of process.stdin) {
    raw += chunk;
  }

  raw = raw.trim();
  if (!raw) {
    console.log(JSON.stringify({
      routes: [],
      middleware: [],
      unguarded_routes: [],
      errors: ['Empty input'],
    }));
    return;
  }

  var result = analyzeRouting(raw);
  console.log(JSON.stringify(result));
}

main().catch(function (err) {
  console.log(JSON.stringify({
    routes: [],
    middleware: [],
    unguarded_routes: [],
    errors: ['Script error: ' + err.message],
  }));
  process.exit(1);
});
