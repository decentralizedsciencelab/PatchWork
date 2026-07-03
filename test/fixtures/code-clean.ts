/**
 * Clean code samples that should produce 0 failures (or only expected warnings).
 * These fixtures verify that the failure detector does not produce false positives
 * on well-formed code.
 */

export interface CleanFixture {
  name: string;
  code: string;
  language: 'Python' | 'TypeScript';
}

// ---------------------------------------------------------------------------
// Clean Python: All imports are stdlib, no config issues, proper returns
// ---------------------------------------------------------------------------
export const CLEAN_PYTHON_STDLIB: CleanFixture = {
  name: 'Clean Python with stdlib imports and proper structure',
  code: `
import json
import os
import sys
from typing import List, Optional, Dict
from collections import OrderedDict
from datetime import datetime
from pathlib import Path

def load_config(path: str) -> Dict:
    """Load configuration from a JSON file."""
    config_path = Path(path)
    if not config_path.exists():
        return {}
    with open(config_path, "r") as f:
        return json.load(f)

def process_items(items: List[str]) -> List[str]:
    """Process a list of items and return filtered results."""
    result = []
    for item in items:
        if item and len(item) > 0:
            result.append(item.strip().lower())
    return result

def find_duplicates(items: List[str]) -> List[str]:
    """Find duplicate items in a list."""
    seen = OrderedDict()
    duplicates = []
    for item in items:
        if item in seen:
            duplicates.append(item)
        seen[item] = True
    return duplicates

def main() -> None:
    config = load_config("config.json")
    items = config.get("items", [])
    processed = process_items(items)
    dupes = find_duplicates(processed)
    if dupes:
        print(f"Found {len(dupes)} duplicates")
    else:
        print("No duplicates found")

if __name__ == "__main__":
    main()
`,
  language: 'Python',
};

// ---------------------------------------------------------------------------
// Clean TypeScript: Proper types, consistent naming, valid imports
// ---------------------------------------------------------------------------
export const CLEAN_TYPESCRIPT_PROPER: CleanFixture = {
  name: 'Clean TypeScript with proper types and consistent naming',
  code: `
interface UserData {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: Date;
}

interface UserCreateInput {
  firstName: string;
  lastName: string;
  email: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}

function createUser(input: UserCreateInput): ApiResponse<UserData> {
  if (!validateEmail(input.email)) {
    return {
      success: false,
      data: {} as UserData,
      message: "Invalid email address",
    };
  }

  const user: UserData = {
    id: Math.random().toString(36).substr(2, 9),
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    createdAt: new Date(),
  };

  return {
    success: true,
    data: user,
    message: "User created successfully",
  };
}

function getUserFullName(user: UserData): string {
  return user.firstName + " " + user.lastName;
}

function formatResponse<T>(response: ApiResponse<T>): string {
  if (response.success) {
    return JSON.stringify(response.data);
  }
  return response.message;
}
`,
  language: 'TypeScript',
};

// ---------------------------------------------------------------------------
// Clean Python: FastAPI app with proper structure
// ---------------------------------------------------------------------------
export const CLEAN_PYTHON_FASTAPI: CleanFixture = {
  name: 'Clean Python FastAPI app with proper structure',
  code: `
from typing import List, Optional
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)

class ItemModel:
    def __init__(self, name: str, price: float, quantity: int):
        self.name = name
        self.price = price
        self.quantity = quantity

    def total_value(self) -> float:
        return self.price * self.quantity

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "price": self.price,
            "quantity": self.quantity,
            "total_value": self.total_value(),
        }

def validate_item(data: dict) -> Optional[str]:
    """Validate item data. Returns error message or None."""
    if "name" not in data:
        return "Missing name field"
    if "price" not in data or data["price"] < 0:
        return "Invalid price"
    if "quantity" not in data or data["quantity"] < 0:
        return "Invalid quantity"
    return None

def create_item(data: dict) -> dict:
    error = validate_item(data)
    if error:
        return {"error": error}
    item = ItemModel(data["name"], data["price"], data["quantity"])
    logger.info(f"Created item: {item.name}")
    return item.to_dict()

def list_items(items: List[ItemModel]) -> List[dict]:
    return [item.to_dict() for item in items]
`,
  language: 'Python',
};

// Export all clean fixtures
export const ALL_CLEAN_FIXTURES: CleanFixture[] = [
  CLEAN_PYTHON_STDLIB,
  CLEAN_TYPESCRIPT_PROPER,
  CLEAN_PYTHON_FASTAPI,
];
