#!/usr/bin/env python3
"""AST-based routing/middleware analysis for Python web frameworks.
Reads raw Python code from stdin, outputs JSON to stdout.

Detects:
- FastAPI/Flask route decorators (@app.get, @router.post, @app.route, etc.)
- Depends(...) in function parameters (auth guards)
- app.add_middleware(...) calls
- Django patterns: @login_required, @permission_required, urlpatterns, MIDDLEWARE
"""
import ast
import json
import sys
import re


# HTTP methods recognised in decorators
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}

# Known auth-related Depends guard names
AUTH_GUARD_HINTS = {
    "get_current_user",
    "get_current_active_user",
    "get_admin_user",
    "require_auth",
    "require_admin",
    "verify_token",
    "authenticate",
    "check_permissions",
    "auth_required",
}

# Django auth decorators
DJANGO_AUTH_DECORATORS = {
    "login_required",
    "permission_required",
    "user_passes_test",
    "staff_member_required",
}


def _unparse_safe(node):
    """Safely unparse an AST node, returning None on failure."""
    try:
        return ast.unparse(node)
    except Exception:
        return None


def _extract_string_arg(call_node):
    """Extract the first string argument from a Call node."""
    if call_node.args:
        arg = call_node.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return arg.value
    return None


def _is_depends_call(node):
    """Check if an AST node is a Depends(...) call and return the guard name."""
    if not isinstance(node, ast.Call):
        return None
    func_str = _unparse_safe(node.func)
    if func_str and "Depends" in func_str:
        if node.args:
            return _unparse_safe(node.args[0])
    return None


def _is_auth_guard(guard_name):
    """Heuristic: does this guard name look like an auth guard?"""
    if not guard_name:
        return False
    lower = guard_name.lower()
    # Exact match against known names
    if guard_name in AUTH_GUARD_HINTS:
        return True
    # Substring heuristics
    for hint in ("auth", "login", "permission", "token", "current_user", "admin", "verify"):
        if hint in lower:
            return True
    return False


def analyze_routing(code):
    """Analyse Python code for routing and middleware patterns."""
    routes = []
    middleware = []
    errors = []

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {
            "routes": [],
            "middleware": [],
            "unguarded_routes": [],
            "errors": [f"SyntaxError: {e.msg} at line {e.lineno}"],
        }

    # --- Pass 1: Collect routes from decorated functions ---
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            route_info = _extract_route_from_decorators(node)
            if route_info:
                routes.append(route_info)

    # --- Pass 2: Collect middleware (app.add_middleware / MIDDLEWARE list) ---
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func_str = _unparse_safe(node.func)
            if func_str and "add_middleware" in func_str:
                mw_name = None
                if node.args:
                    mw_name = _unparse_safe(node.args[0])
                middleware.append({
                    "name": mw_name or "unknown",
                    "line": node.lineno,
                    "type": "add_middleware",
                })

        # Django MIDDLEWARE = [...] list
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "MIDDLEWARE":
                    if isinstance(node.value, ast.List):
                        for elt in node.value.elts:
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                middleware.append({
                                    "name": elt.value,
                                    "line": elt.lineno,
                                    "type": "django_middleware",
                                })

    # --- Pass 3: Django urlpatterns ---
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "urlpatterns":
                    if isinstance(node.value, ast.List):
                        for elt in node.value.elts:
                            url_route = _extract_django_url_pattern(elt)
                            if url_route:
                                routes.append(url_route)

    # --- Pass 4: Compute unguarded routes ---
    unguarded = _find_unguarded_routes(routes)

    return {
        "routes": routes,
        "middleware": middleware,
        "unguarded_routes": unguarded,
        "errors": errors,
    }


def _extract_route_from_decorators(func_node):
    """Extract route info from a function's decorators (FastAPI/Flask/Django)."""
    for decorator in func_node.decorator_list:
        # --- Django auth decorators (not route decorators but relevant for auth) ---
        dec_str = _unparse_safe(decorator)

        # --- @app.get("/path"), @router.post("/path"), @app.route("/path") ---
        if isinstance(decorator, ast.Call):
            func_str = _unparse_safe(decorator.func)
            if not func_str:
                continue

            method = None
            path_str = None

            # Check for @app.get(...), @router.post(...), etc.
            if isinstance(decorator.func, ast.Attribute):
                attr = decorator.func.attr.lower()
                if attr in HTTP_METHODS:
                    method = attr.upper()
                    path_str = _extract_string_arg(decorator)
                elif attr == "route":
                    path_str = _extract_string_arg(decorator)
                    # Flask @app.route may have methods=["GET","POST"]
                    method = "GET"  # default
                    for kw in decorator.keywords:
                        if kw.arg == "methods" and isinstance(kw.value, ast.List):
                            methods = []
                            for elt in kw.value.elts:
                                if isinstance(elt, ast.Constant):
                                    methods.append(str(elt.value).upper())
                            if methods:
                                method = ",".join(methods)

            if path_str is None and method is None:
                continue

            # Extract guards from function parameters (Depends)
            guards = []
            has_auth = False
            for arg in func_node.args.args + func_node.args.kwonlyargs:
                if arg.annotation:
                    guard_name = _is_depends_call(arg.annotation)
                    if guard_name:
                        guards.append(guard_name)
                        if _is_auth_guard(guard_name):
                            has_auth = True

            # Also check default values for Depends(...)
            all_defaults = func_node.args.defaults + func_node.args.kw_defaults
            for default in all_defaults:
                if default is not None:
                    guard_name = _is_depends_call(default)
                    if guard_name:
                        guards.append(guard_name)
                        if _is_auth_guard(guard_name):
                            has_auth = True

            # Check for Django-style auth decorators on this function
            for dec in func_node.decorator_list:
                dec_name = _unparse_safe(dec)
                if dec_name:
                    for django_dec in DJANGO_AUTH_DECORATORS:
                        if django_dec in dec_name:
                            has_auth = True
                            guards.append(django_dec)

            # Check for Flask login_required decorator
            for dec in func_node.decorator_list:
                if isinstance(dec, ast.Name) and dec.id == "login_required":
                    has_auth = True
                    guards.append("login_required")
                elif isinstance(dec, ast.Call):
                    call_str = _unparse_safe(dec.func)
                    if call_str and "login_required" in call_str:
                        has_auth = True
                        guards.append("login_required")

            return {
                "path": path_str or "<unknown>",
                "method": method or "GET",
                "file": "<stdin>",
                "line": func_node.lineno,
                "guards": guards,
                "has_auth": has_auth,
            }

        # --- Simple decorator (no call): e.g., @login_required ---
        elif isinstance(decorator, ast.Name):
            if decorator.id in DJANGO_AUTH_DECORATORS:
                # This is not a route decorator, but note it for auth tracking
                # Only flag route if another decorator on this func defines a route
                pass

    return None


def _extract_django_url_pattern(elt):
    """Extract route info from a Django urlpatterns entry like path('api/', view)."""
    if not isinstance(elt, ast.Call):
        return None

    func_str = _unparse_safe(elt.func)
    if not func_str:
        return None

    if func_str not in ("path", "re_path", "url"):
        return None

    path_str = _extract_string_arg(elt)
    view_name = None
    if len(elt.args) > 1:
        view_name = _unparse_safe(elt.args[1])

    return {
        "path": path_str or "<unknown>",
        "method": "ALL",
        "file": "<stdin>",
        "line": elt.lineno,
        "guards": [],
        "has_auth": False,
        "view": view_name,
    }


def _find_unguarded_routes(routes):
    """If most routes have auth guards, flag the ones that don't."""
    if len(routes) < 2:
        return []

    guarded_count = sum(1 for r in routes if r["has_auth"])
    total = len(routes)

    # Only flag if majority of routes are guarded
    if guarded_count <= total / 2:
        return []

    unguarded = []
    for route in routes:
        if not route["has_auth"]:
            unguarded.append({
                "path": route["path"],
                "line": route["line"],
                "reason": (
                    f"No auth guard while {guarded_count}/{total} sibling routes use auth guards"
                ),
            })

    return unguarded


if __name__ == "__main__":
    code = sys.stdin.read()
    result = analyze_routing(code)
    print(json.dumps(result))
