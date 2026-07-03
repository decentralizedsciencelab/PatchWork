#!/usr/bin/env python3
"""AST-based structural analysis for CFG, schema, and config detection.
Reads JSON from stdin: {"code": "...", "analysis": "cfg"|"schema"|"config"}
Outputs JSON to stdout."""
import ast
import json
import os
import re
import sys


def analyze_cfg(code: str) -> dict:
    """Extract control flow graph nodes from Python code."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"functions": [], "errors": [f"SyntaxError: {e.msg}"]}

    functions = []

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            cfg_nodes = []
            has_return = False
            return_type = None

            # Check return annotation
            if node.returns:
                has_return = True
                try:
                    return_type = ast.unparse(node.returns)
                except:
                    return_type = "unknown"

            # Walk direct body statements (preserving order) for control flow
            block_counter = [0]  # mutable counter for unique block IDs

            def _alloc_block():
                bid = f"blk_{block_counter[0]}"
                block_counter[0] += 1
                return bid

            def _walk_body(stmts, parent_block_id=None, block_id=None, block_kind="function_body"):
                nonlocal has_return
                if block_id is None:
                    block_id = _alloc_block()

                hit_terminator = False
                for child in stmts:
                    # Statements after return/raise at the same block level are unreachable
                    if hit_terminator:
                        cfg_nodes.append({
                            "type": "unreachable", "line": child.lineno,
                            "functionScope": node.name,
                            "blockId": block_id, "parentBlockId": parent_block_id,
                            "blockKind": block_kind, "isTerminator": False,
                        })
                        continue

                    base_props = {
                        "blockId": block_id,
                        "parentBlockId": parent_block_id,
                        "blockKind": block_kind,
                        "isTerminator": False,
                    }

                    if isinstance(child, ast.If):
                        try:
                            cond = ast.unparse(child.test)[:80]
                        except:
                            cond = "..."
                        cfg_nodes.append({
                            "type": "conditional", "line": child.lineno,
                            "condition": cond, **base_props,
                        })
                        true_blk = _alloc_block()
                        _walk_body(child.body, block_id, true_blk, "if_true")
                        if child.orelse:
                            false_blk = _alloc_block()
                            _walk_body(child.orelse, block_id, false_blk, "if_false")
                    elif isinstance(child, ast.For):
                        cfg_nodes.append({
                            "type": "loop", "line": child.lineno,
                            "loopType": "for", **base_props,
                        })
                        body_blk = _alloc_block()
                        _walk_body(child.body, block_id, body_blk, "for_body")
                    elif isinstance(child, ast.While):
                        cfg_nodes.append({
                            "type": "loop", "line": child.lineno,
                            "loopType": "while", **base_props,
                        })
                        body_blk = _alloc_block()
                        _walk_body(child.body, block_id, body_blk, "while_body")
                    elif isinstance(child, ast.Try):
                        cfg_nodes.append({
                            "type": "try", "line": child.lineno, **base_props,
                        })
                        try_blk = _alloc_block()
                        _walk_body(child.body, block_id, try_blk, "try_body")
                        for handler in child.handlers:
                            handler_blk = _alloc_block()
                            _walk_body(handler.body, block_id, handler_blk, "except_handler")
                        if child.orelse:
                            else_blk = _alloc_block()
                            _walk_body(child.orelse, block_id, else_blk, "try_else")
                        if child.finalbody:
                            finally_blk = _alloc_block()
                            _walk_body(child.finalbody, block_id, finally_blk, "finally")
                    elif isinstance(child, ast.With):
                        cfg_nodes.append({
                            "type": "with", "line": child.lineno, **base_props,
                        })
                        with_blk = _alloc_block()
                        _walk_body(child.body, block_id, with_blk, "with_body")
                    elif isinstance(child, ast.Return):
                        has_return = True
                        cfg_nodes.append({
                            "type": "return", "line": child.lineno,
                            "functionScope": node.name,
                            "blockId": block_id, "parentBlockId": parent_block_id,
                            "blockKind": block_kind, "isTerminator": True,
                        })
                        hit_terminator = True
                    elif isinstance(child, ast.Raise):
                        cfg_nodes.append({
                            "type": "raise", "line": child.lineno,
                            "blockId": block_id, "parentBlockId": parent_block_id,
                            "blockKind": block_kind, "isTerminator": True,
                        })
                        hit_terminator = True
                    elif isinstance(child, ast.Break):
                        cfg_nodes.append({
                            "type": "break", "line": child.lineno,
                            "functionScope": node.name,
                            "blockId": block_id, "parentBlockId": parent_block_id,
                            "blockKind": block_kind, "isTerminator": True,
                        })
                        hit_terminator = True
                    elif isinstance(child, ast.Continue):
                        cfg_nodes.append({
                            "type": "continue", "line": child.lineno,
                            "functionScope": node.name,
                            "blockId": block_id, "parentBlockId": parent_block_id,
                            "blockKind": block_kind, "isTerminator": True,
                        })
                        hit_terminator = True
                    elif isinstance(child, (ast.Expr, ast.Assign, ast.AugAssign, ast.AnnAssign,
                                            ast.Delete, ast.Assert, ast.Pass)):
                        cfg_nodes.append({
                            "type": "statement", "line": child.lineno,
                            "functionScope": node.name, **base_props,
                        })

            _walk_body(node.body)

            # Determine if function has a meaningful return type (not void-like)
            def _is_void_like(rt):
                if rt is None or rt == "None":
                    return True
                # Optional[None], Optional[...] where inner is None-ish
                if rt == "Optional[None]":
                    return True
                # None | ... union types
                stripped = rt.replace(" ", "")
                if stripped == "None|None" or stripped == "None":
                    return True
                # NoReturn, Never
                if rt in ("NoReturn", "Never"):
                    return True
                return False

            functions.append({
                "name": node.name,
                "line": node.lineno,
                "hasReturnType": return_type is not None and not _is_void_like(return_type),
                "returnType": return_type,
                "isAsync": isinstance(node, ast.AsyncFunctionDef),
                "cfgNodes": cfg_nodes,
            })

    return {"functions": functions, "errors": []}


def analyze_schema(code: str) -> dict:
    """Extract schema/model definitions (Pydantic, dataclass, SQLAlchemy, etc.)."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"schemas": [], "errors": [f"SyntaxError: {e.msg}"]}

    schemas = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue

        # Detect schema type from base classes
        bases = []
        schema_type = "class"
        for base in node.bases:
            try:
                base_name = ast.unparse(base)
                bases.append(base_name)
                if "BaseModel" in base_name or "BaseSchema" in base_name:
                    schema_type = "pydantic"
                elif "TypedDict" in base_name:
                    schema_type = "typeddict"
                elif "Serializer" in base_name:
                    schema_type = "drf-serializer"
                elif "Model" in base_name and "django" in code.lower():
                    schema_type = "django"
                elif "Base" in base_name and ("Column" in code or "mapped_column" in code):
                    schema_type = "sqlalchemy"
            except:
                pass

        # Detect dataclass and attrs
        for decorator in node.decorator_list:
            try:
                dec_name = ast.unparse(decorator)
                if "dataclass" in dec_name:
                    schema_type = "dataclass"
                elif dec_name in ("attr.s", "attr.attrs", "attrs", "define", "attr.define"):
                    schema_type = "attrs"
                elif "attr.s" in dec_name or "attr.attrs" in dec_name or "attr.define" in dec_name:
                    schema_type = "attrs"
            except:
                pass

        # Extract fields — both annotated (AnnAssign) and unannotated (Assign with Column/Field patterns)
        fields = []
        for item in node.body:
            if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                field_name = item.target.id
                try:
                    field_type = ast.unparse(item.annotation) if item.annotation else "Any"
                except:
                    field_type = "Any"

                constraints = []
                if item.value:
                    try:
                        val_str = ast.unparse(item.value)
                        if "Field(" in val_str:
                            if "..." in val_str:
                                constraints.append({"type": "required"})
                            if "min_length" in val_str:
                                constraints.append({"type": "minLength"})
                            if "max_length" in val_str:
                                constraints.append({"type": "maxLength"})
                            if "gt=" in val_str or "ge=" in val_str:
                                constraints.append({"type": "minimum"})
                    except:
                        pass

                fields.append({
                    "name": field_name,
                    "dataType": field_type,
                    "constraints": constraints,
                    "line": item.lineno,
                })

            # Unannotated fields: SQLAlchemy Column(), Django models.XField(), etc.
            elif isinstance(item, ast.Assign):
                for target in item.targets:
                    if not isinstance(target, ast.Name):
                        continue
                    if not isinstance(item.value, ast.Call):
                        continue
                    try:
                        call_str = ast.unparse(item.value.func)
                    except:
                        continue
                    # Match patterns: Column(...), db.Column(...), models.CharField(...), etc.
                    is_field_call = (
                        "Column" in call_str or
                        "Field" in call_str or
                        "CharField" in call_str or
                        "IntegerField" in call_str or
                        "TextField" in call_str or
                        "BooleanField" in call_str or
                        "FloatField" in call_str or
                        "DateField" in call_str or
                        "DateTimeField" in call_str or
                        "ForeignKey" in call_str or
                        "relationship" in call_str or
                        "mapped_column" in call_str
                    )
                    if is_field_call:
                        # Try to infer type from first positional arg (SQLAlchemy: Column(Integer, ...))
                        field_type = "Any"
                        if item.value.args:
                            try:
                                field_type = ast.unparse(item.value.args[0])
                            except:
                                pass
                        fields.append({
                            "name": target.id,
                            "dataType": field_type,
                            "constraints": [],
                            "line": item.lineno,
                        })

        if fields or schema_type != "class":
            schemas.append({
                "name": node.name,
                "type": schema_type,
                "bases": bases,
                "fields": fields,
                "line": node.lineno,
            })

    return {"schemas": schemas, "errors": []}


def _is_inside_try_except(tree: ast.AST, target_node: ast.AST) -> bool:
    """Check if target_node is inside a try block that catches KeyError/OSError/Exception."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Try):
            # Check if any handler catches KeyError, OSError, or bare Exception
            catches_relevant = False
            for handler in node.handlers:
                if handler.type is None:
                    # bare except:
                    catches_relevant = True
                    break
                try:
                    handler_name = ast.unparse(handler.type)
                    if any(exc in handler_name for exc in ["KeyError", "OSError", "Exception"]):
                        catches_relevant = True
                        break
                except:
                    pass
            if catches_relevant:
                # Check if target_node is inside this try body
                for child in ast.walk(node):
                    if child is target_node:
                        return True
    return False


def _has_guard_check(tree: ast.AST, var_name: str, target_line: int) -> bool:
    """Check if there's an 'if KEY in os.environ' or 'if os.getenv(KEY)' guard before access."""
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and node.lineno < target_line:
            try:
                test_str = ast.unparse(node.test)
                if (f'"{var_name}" in os.environ' in test_str or
                    f"'{var_name}' in os.environ" in test_str or
                    f'os.getenv("{var_name}")' in test_str or
                    f"os.getenv('{var_name}')" in test_str or
                    f'os.environ.get("{var_name}")' in test_str or
                    f"os.environ.get('{var_name}')" in test_str):
                    # Check if target_line is inside this if body or its orelse
                    for child in ast.walk(node):
                        if hasattr(child, 'lineno') and child.lineno == target_line:
                            return True
            except:
                pass
    return False


def analyze_config(code: str) -> dict:
    """Extract configuration patterns from Python code.

    Only emits env var entries for provably unsafe accesses:
    - os.environ[KEY] (subscript) — throws KeyError if missing
    - os.getenv(KEY) without default — returns None (may crash downstream)

    Safe patterns are skipped entirely:
    - os.getenv(KEY, default)
    - os.environ.get(KEY, ...)
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {"configs": [], "envVars": [], "errors": [f"SyntaxError: {e.msg}"]}

    configs = []
    enriched_env_vars = []

    # Pass 1: Find unsafe env var accesses
    for node in ast.walk(tree):
        # os.environ[KEY] — hard subscript, throws KeyError
        if isinstance(node, ast.Subscript):
            try:
                val_str = ast.unparse(node.value)
                if "os.environ" in val_str and isinstance(node.slice, ast.Constant):
                    var_name = node.slice.value
                    line = node.lineno

                    safety_context = None
                    if _is_inside_try_except(tree, node):
                        safety_context = "try_except"
                    elif _has_guard_check(tree, var_name, line):
                        safety_context = "guard_check"

                    enriched_env_vars.append({
                        "name": var_name,
                        "accessMethod": "subscript",
                        "line": line,
                        "safetyContext": safety_context,
                    })
            except:
                pass

        # os.getenv(KEY) or os.environ.get(KEY) calls
        if isinstance(node, ast.Call):
            try:
                func_str = ast.unparse(node.func)
                if "getenv" in func_str or "environ.get" in func_str:
                    if node.args and isinstance(node.args[0], ast.Constant):
                        var_name = node.args[0].value
                        has_default = len(node.args) >= 2 or len(node.keywords) > 0

                        # Skip safe patterns: getenv with default, environ.get with default
                        if has_default:
                            continue
                        # environ.get(KEY) without default returns None — safe by itself
                        if "environ.get" in func_str:
                            continue

                        # os.getenv(KEY) without default — returns None, may crash downstream
                        line = node.lineno

                        safety_context = None
                        if _is_inside_try_except(tree, node):
                            safety_context = "try_except"
                        elif _has_guard_check(tree, var_name, line):
                            safety_context = "guard_check"

                        enriched_env_vars.append({
                            "name": var_name,
                            "accessMethod": "getenv_no_default",
                            "line": line,
                            "safetyContext": safety_context,
                        })
            except:
                pass

        # Find config classes (Settings, Config, etc.)
        if isinstance(node, ast.ClassDef):
            is_config = False
            for base in node.bases:
                try:
                    base_str = ast.unparse(base)
                    if "Settings" in base_str or "Config" in base_str:
                        is_config = True
                except:
                    pass

            if is_config or node.name.endswith("Config") or node.name.endswith("Settings"):
                fields = []
                for item in node.body:
                    if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                        value = None
                        expected_type = None
                        try:
                            if item.value:
                                value = ast.unparse(item.value)
                            if item.annotation:
                                expected_type = ast.unparse(item.annotation)
                        except:
                            pass
                        fields.append({
                            "name": item.target.id,
                            "value": value,
                            "expectedType": expected_type,
                            "line": item.lineno,
                        })
                    elif isinstance(item, ast.Assign):
                        for target in item.targets:
                            if isinstance(target, ast.Name):
                                try:
                                    value = ast.unparse(item.value)
                                except:
                                    value = None
                                fields.append({
                                    "name": target.id,
                                    "value": value,
                                    "expectedType": None,
                                    "line": item.lineno,
                                })

                configs.append({
                    "name": node.name,
                    "type": "config_class",
                    "fields": fields,
                    "line": node.lineno,
                })

    # Find top-level config dicts
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and isinstance(node.value, ast.Dict):
                    name = target.id
                    if any(kw in name.lower() for kw in ["config", "settings", "options", "defaults"]):
                        fields = []
                        for key, val in zip(node.value.keys, node.value.values):
                            if isinstance(key, ast.Constant):
                                try:
                                    v = ast.unparse(val)
                                except:
                                    v = None
                                fields.append({
                                    "name": str(key.value),
                                    "value": v,
                                    "expectedType": None,
                                    "line": node.lineno,
                                })
                        configs.append({
                            "name": name,
                            "type": "config_dict",
                            "fields": fields,
                            "line": node.lineno,
                        })

    # Extract env var names for backward-compatible envVars list
    env_vars = sorted(set(e["name"] for e in enriched_env_vars))

    return {"configs": configs, "envVars": env_vars, "envVarsEnriched": enriched_env_vars, "errors": []}


if __name__ == "__main__":
    raw = sys.stdin.read()
    try:
        input_data = json.loads(raw)
        code = input_data["code"]
        analysis = input_data["analysis"]
    except (json.JSONDecodeError, KeyError):
        # If raw input, assume code for cfg analysis
        code = raw
        analysis = "cfg"

    if analysis == "cfg":
        result = analyze_cfg(code)
    elif analysis == "schema":
        result = analyze_schema(code)
    elif analysis == "config":
        result = analyze_config(code)
    else:
        result = {"error": f"Unknown analysis type: {analysis}"}

    print(json.dumps(result))
