#!/usr/bin/env python3
"""AST-based Python resource/path reference analysis. Reads code from stdin, outputs JSON."""
import ast
import json
import sys


def analyze_resources(code: str) -> dict:
    resources = []
    errors = []

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"resources": [], "errors": [f"SyntaxError: {e.msg} at line {e.lineno}"]}

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        func = node.func
        func_name = _get_func_name(func)
        if func_name is None:
            continue

        # open("path") / open("path", "r")
        if func_name == "open" and node.args:
            path_val = _get_string_value(node.args[0])
            if path_val is not None:
                resources.append({
                    "file": "generated_code",
                    "line": node.lineno,
                    "referenced_path": path_val,
                    "type": "file_read",
                })

        # Path("path")
        if func_name in ("Path", "PurePath", "PosixPath", "WindowsPath") and node.args:
            path_val = _get_string_value(node.args[0])
            if path_val is not None:
                resources.append({
                    "file": "generated_code",
                    "line": node.lineno,
                    "referenced_path": path_val,
                    "type": "file_read",
                })

        # render_template("path"), get_template("path")
        if func_name in ("render_template", "get_template", "select_template",
                         "render_to_string", "render_to_response") and node.args:
            path_val = _get_string_value(node.args[0])
            if path_val is not None:
                resources.append({
                    "file": "generated_code",
                    "line": node.lineno,
                    "referenced_path": path_val,
                    "type": "template",
                })

        # Django static("path")
        if func_name == "static" and node.args:
            path_val = _get_string_value(node.args[0])
            if path_val is not None:
                resources.append({
                    "file": "generated_code",
                    "line": node.lineno,
                    "referenced_path": path_val,
                    "type": "static_file",
                })

    # Also look for STATICFILES_DIRS assignments and Django migration dependencies
    for node in ast.walk(tree):
        # STATICFILES_DIRS = [...]
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "STATICFILES_DIRS":
                    if isinstance(node.value, (ast.List, ast.Tuple)):
                        for elt in node.value.elts:
                            path_val = _get_string_value(elt)
                            if path_val is not None:
                                resources.append({
                                    "file": "generated_code",
                                    "line": node.lineno,
                                    "referenced_path": path_val,
                                    "type": "static_file",
                                })

        # Django migration dependencies: dependencies = [("app", "0001_initial")]
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "dependencies":
                    if isinstance(node.value, (ast.List, ast.Tuple)):
                        for elt in node.value.elts:
                            if isinstance(elt, ast.Tuple) and len(elt.elts) >= 2:
                                app_val = _get_string_value(elt.elts[0])
                                migration_val = _get_string_value(elt.elts[1])
                                if app_val is not None and migration_val is not None:
                                    resources.append({
                                        "file": "generated_code",
                                        "line": node.lineno,
                                        "referenced_path": f"{app_val}/migrations/{migration_val}",
                                        "type": "migration",
                                    })

    return {"resources": resources, "errors": errors}


def _get_func_name(func_node) -> str | None:
    """Extract a simple function name from a call's func attribute."""
    if isinstance(func_node, ast.Name):
        return func_node.id
    if isinstance(func_node, ast.Attribute):
        return func_node.attr
    return None


def _get_string_value(node) -> str | None:
    """Extract a string constant value from an AST node, if it is one."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    # Handle older AST Str nodes (Python < 3.8 compat, rarely needed)
    if hasattr(ast, "Str") and isinstance(node, ast.Str):
        return node.s
    return None


if __name__ == "__main__":
    code = sys.stdin.read()
    result = analyze_resources(code)
    print(json.dumps(result))
