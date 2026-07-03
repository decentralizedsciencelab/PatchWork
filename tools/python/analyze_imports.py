#!/usr/bin/env python3
"""AST-based Python import analysis. Reads code from stdin, outputs JSON."""
import ast
import json
import sys


def analyze_imports(code: str) -> dict:
    imports = []
    errors = []

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"imports": [], "errors": [f"SyntaxError: {e.msg} at line {e.lineno}"]}

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({
                    "type": "import",
                    "module": alias.name,
                    "names": [alias.asname or alias.name],
                    "line": node.lineno,
                    "isRelative": False,
                    "level": 0,
                })
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names = [a.name for a in node.names]
            is_relative = (node.level or 0) > 0
            prefix = "." * (node.level or 0)
            full_module = f"{prefix}{module}" if is_relative else module

            imports.append({
                "type": "from",
                "module": full_module,
                "names": names,
                "line": node.lineno,
                "isRelative": is_relative,
                "level": node.level or 0,
            })

    return {"imports": imports, "errors": errors}


if __name__ == "__main__":
    code = sys.stdin.read()
    result = analyze_imports(code)
    print(json.dumps(result))
