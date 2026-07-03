#!/usr/bin/env python3
"""Registry validation for pip packages. Reads JSON from stdin, outputs JSON."""
import json
import os
import ssl
import sys
import time
import urllib.request
import urllib.error

CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.registry_cache.json')
RATE_LIMIT_DELAY = 0.5


def load_cache():
    """Load cached registry results from disk."""
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_cache(cache):
    """Persist cache to disk."""
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(cache, f)
    except IOError:
        pass


def _get_ssl_context():
    """Build an SSL context, trying certifi first, then system defaults, then unverified."""
    # Try certifi
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass

    # Try default system context
    ctx = ssl.create_default_context()
    return ctx


def _urlopen_with_fallback(req, timeout=10):
    """Open a URL, falling back to unverified SSL if certificate verification fails."""
    try:
        ctx = _get_ssl_context()
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)
    except (urllib.error.URLError, OSError) as e:
        if 'CERTIFICATE_VERIFY_FAILED' in str(e):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return urllib.request.urlopen(req, timeout=timeout, context=ctx)
        raise


def check_pip_package(package, cache):
    """Check if a package exists on PyPI. Returns a result dict."""
    cache_key = f"pip:{package}"
    # Only use cache for results without errors
    if cache_key in cache and 'error' not in cache[cache_key]:
        return cache[cache_key]

    url = f"https://pypi.org/pypi/{package}/json"
    try:
        req = urllib.request.Request(url, method='GET')
        req.add_header('User-Agent', 'patchwork-registry-validator/1.0')
        with _urlopen_with_fallback(req, timeout=10) as resp:
            result = {"package": package, "exists": resp.status == 200}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            result = {"package": package, "exists": False}
        else:
            result = {"package": package, "exists": False, "error": f"HTTP error: {e.code}"}
    except (urllib.error.URLError, OSError) as e:
        result = {"package": package, "exists": False, "error": f"Network error: {str(e)}"}

    # Only cache successful results (no error field)
    if 'error' not in result:
        cache[cache_key] = result
    return result


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"results": [], "error": "Empty input"}))
        return

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"results": [], "error": f"Invalid JSON: {str(e)}"}))
        return

    packages = data.get("packages", [])
    ecosystem = data.get("ecosystem", "pip")

    if ecosystem != "pip":
        print(json.dumps({"results": [], "error": f"Unsupported ecosystem: {ecosystem}"}))
        return

    cache = load_cache()
    results = []

    for i, package in enumerate(packages):
        cache_key = f"pip:{package}"
        was_cached = cache_key in cache and 'error' not in cache[cache_key]
        result = check_pip_package(package, cache)
        results.append(result)
        # Rate limit: delay between requests (skip for cached or last item)
        if i < len(packages) - 1 and not was_cached:
            time.sleep(RATE_LIMIT_DELAY)

    save_cache(cache)
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
