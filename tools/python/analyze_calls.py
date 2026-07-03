#!/usr/bin/env python3
"""AST-based Python call graph analysis. Uses PyCG if available, falls back to AST.
Reads code from stdin, outputs JSON."""
import ast
import json
import sys
import os
import tempfile


class CallVisitor(ast.NodeVisitor):
    """Extract function definitions and call sites from Python AST."""

    def __init__(self):
        self.functions = []
        self.calls = []
        self._current_scope = []

    def visit_FunctionDef(self, node):
        self._process_func(node)

    def visit_AsyncFunctionDef(self, node):
        self._process_func(node, is_async=True)

    def _process_func(self, node, is_async=False):
        decorators = []
        for d in node.decorator_list:
            if isinstance(d, ast.Name):
                decorators.append(d.id)
            elif isinstance(d, ast.Attribute):
                decorators.append(ast.unparse(d))

        func_info = {
            "name": node.name,
            "line": node.lineno,
            "parameters": len(node.args.args),
            "decorators": decorators,
            "isAsync": is_async,
            "isMethod": len(self._current_scope) > 0 and isinstance(
                self._current_scope[-1], ast.ClassDef
            ),
        }
        self.functions.append(func_info)

        # Track calls within this function
        self._current_scope.append(node)
        call_targets = []
        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                target = self._resolve_call_target(child)
                if target:
                    call_targets.append(target)

        if call_targets:
            self.calls.append({
                "caller": node.name,
                "callees": list(set(call_targets)),
                "line": node.lineno,
            })

        self.generic_visit(node)
        self._current_scope.pop()

    def visit_ClassDef(self, node):
        self._current_scope.append(node)
        self.generic_visit(node)
        self._current_scope.pop()

    def _resolve_call_target(self, node: ast.Call) -> str:
        return self._resolve_name(node.func)

    def _resolve_name(self, node) -> str:
        """Recursively resolve a dotted name (e.g. module.func → 'module.func')."""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            value = self._resolve_name(node.value)
            if value:
                return f"{value}.{node.attr}"
            return node.attr
        return ""


def try_pycg(code: str) -> dict:
    """Try to use PyCG for more accurate call graph. Returns None if unavailable."""
    try:
        pycg_path = "/tmp/pycg_pkg"
        if not os.path.exists(pycg_path):
            return None

        sys.path.insert(0, pycg_path)
        # PyCG needs a symlink from PyCG -> pycg
        pycg_link = os.path.join(pycg_path, "pycg")
        pycg_dir = os.path.join(pycg_path, "PyCG")
        if not os.path.exists(pycg_link) and os.path.exists(pycg_dir):
            os.symlink(pycg_dir, pycg_link)

        from pycg.pycg import CallGraphGenerator

        # Write code to temp file for PyCG
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(code)
            temp_path = f.name

        try:
            cg = CallGraphGenerator(
                [temp_path], os.path.dirname(temp_path), -1, "call-graph"
            )
            cg.analyze()
            result = cg.output()

            # Convert PyCG output {caller: set(callees)} to our format
            functions = set()
            calls = []
            for caller, callees in result.items():
                callees_list = list(callees)
                functions.add(caller)
                for c in callees_list:
                    functions.add(c)
                if callees_list:
                    calls.append({
                        "caller": caller,
                        "callees": callees_list,
                        "line": 0,  # PyCG doesn't track line numbers
                    })

            return {
                "functions": [{"name": f, "line": 0, "parameters": 0, "decorators": [], "isAsync": False, "isMethod": "." in f} for f in functions],
                "calls": calls,
                "toolUsed": "pycg",
            }
        finally:
            os.unlink(temp_path)

    except Exception:
        return None


def analyze_calls_ast(code: str) -> dict:
    """AST-based call analysis (fallback)."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"functions": [], "calls": [], "errors": [f"SyntaxError: {e.msg}"]}

    visitor = CallVisitor()
    visitor.visit(tree)

    # Also capture module-level calls (not inside any function)
    module_call_targets = []
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.Expr, ast.Assign, ast.AnnAssign)):
            for child in ast.walk(node):
                if isinstance(child, ast.Call):
                    target = visitor._resolve_call_target(child)
                    if target:
                        module_call_targets.append(target)

    if module_call_targets:
        visitor.calls.append({
            "caller": "<module>",
            "callees": list(set(module_call_targets)),
            "line": 1,
        })

    return {
        "functions": visitor.functions,
        "calls": visitor.calls,
        "toolUsed": "ast",
        "errors": [],
    }


def analyze_calls(code: str) -> dict:
    # Try PyCG first for better accuracy
    pycg_result = try_pycg(code)
    if pycg_result:
        pycg_result["errors"] = []
        return pycg_result

    # Fallback to AST
    return analyze_calls_ast(code)


if __name__ == "__main__":
    code = sys.stdin.read()
    result = analyze_calls(code)
    print(json.dumps(result))
