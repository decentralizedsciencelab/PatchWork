#!/usr/bin/env python3
"""Type checking via mypy. Reads code from stdin, outputs JSON with type errors."""
import json
import os
import subprocess
import sys
import tempfile


def find_mypy() -> str:
    """Find mypy executable."""
    candidates = [
        os.path.expanduser("~/.local/bin/mypy"),
        "/usr/local/bin/mypy",
        "/usr/bin/mypy",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    # Try PATH
    try:
        result = subprocess.run(["which", "mypy"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    return None


def check_types(code: str) -> dict:
    mypy_path = find_mypy()
    if not mypy_path:
        return {"errors": [], "available": False, "message": "mypy not found"}

    # Write to temp file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        temp_path = f.name

    try:
        result = subprocess.run(
            [mypy_path, temp_path, "--ignore-missing-imports", "--no-error-summary",
             "--no-color-output", "--show-column-numbers"],
            capture_output=True,
            text=True,
            timeout=30,
        )

        errors = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            # Parse mypy output: file:line:col: severity: message [code]
            parts = line.split(":", 4)
            if len(parts) >= 5:
                try:
                    lineno = int(parts[1])
                    col = int(parts[2]) if parts[2].strip().isdigit() else 0
                    severity_msg = parts[3].strip()
                    message = parts[4].strip()

                    # Extract error code if present
                    error_code = ""
                    if message.endswith("]"):
                        bracket_start = message.rfind("[")
                        if bracket_start != -1:
                            error_code = message[bracket_start + 1:-1]
                            message = message[:bracket_start].strip()

                    severity = "error" if "error" in severity_msg else "warning"

                    errors.append({
                        "line": lineno,
                        "column": col,
                        "code": error_code,
                        "message": message,
                        "severity": severity,
                    })
                except (ValueError, IndexError):
                    continue

        return {"errors": errors, "available": True}

    except subprocess.TimeoutExpired:
        return {"errors": [], "available": True, "message": "mypy timed out"}
    except Exception as e:
        return {"errors": [], "available": True, "message": f"mypy error: {str(e)}"}
    finally:
        os.unlink(temp_path)


if __name__ == "__main__":
    code = sys.stdin.read()
    result = check_types(code)
    print(json.dumps(result))
