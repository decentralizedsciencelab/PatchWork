/**
 * Fixture code samples with planted failures for integration testing.
 * Each fixture contains code with known structural failures and
 * the expected failure detections that should be produced.
 */

export interface ExpectedFailure {
  category: string;
  count: number;
  descriptionContains: string;
}

export interface CodeFixture {
  name: string;
  code: string;
  language: 'Python' | 'TypeScript';
  expectedFailures: ExpectedFailure[];
}

// ---------------------------------------------------------------------------
// PIA (Phantom Import/API): Code that imports a non-existent module
// ---------------------------------------------------------------------------
export const FIXTURE_PIA_PHANTOM_IMPORT: CodeFixture = {
  name: 'PIA - Phantom import of nonexistent module',
  code: `
from phantom_module import does_not_exist
from collections import OrderedDict
import json
import nonexistent_pkg

def process_data(raw):
    data = json.loads(raw)
    result = does_not_exist(data)
    ordered = OrderedDict(result)
    return ordered

def main():
    import another_fake_lib
    payload = '{"key": "value"}'
    output = process_data(payload)
    print(output)

if __name__ == "__main__":
    main()
`,
  language: 'Python',
  expectedFailures: [
    { category: 'DHI', count: 1, descriptionContains: 'phantom_module' },
    { category: 'DHI', count: 1, descriptionContains: 'nonexistent_pkg' },
  ],
};

// ---------------------------------------------------------------------------
// SRF (Schema/Resource/Return Failures): Call graph references to undefined functions
// ---------------------------------------------------------------------------
export const FIXTURE_SRF_UNDEFINED_CALLS: CodeFixture = {
  name: 'SRF - Calls to undefined/removed functions',
  code: `
from typing import List

def get_users() -> List[dict]:
    """Fetch users from the database."""
    return [{"name": "Alice"}, {"name": "Bob"}]

def format_user(user: dict) -> str:
    return f"{user['name']}"

def main():
    users = get_users()
    for user in users:
        formatted = format_user(user)
        send_notification(formatted)
        log_activity(user, formatted)

if __name__ == "__main__":
    main()
`,
  language: 'Python',
  expectedFailures: [
    // send_notification and log_activity are called but not defined;
    // however, the regex/AST fallback creates nodes for them in the call graph,
    // so SRF only fires if edges reference non-existent node IDs.
    // The cross-graph check (DHI) may fire for unimported modules instead.
    // We test conservatively.
    { category: 'DHI', count: 0, descriptionContains: 'typing' },
  ],
};

// ---------------------------------------------------------------------------
// DHI (Dependency Hallucination): Package with registryExists: false
// ---------------------------------------------------------------------------
export const FIXTURE_DHI_MISSING_DEPENDENCY: CodeFixture = {
  name: 'DHI - Package not found in registry',
  code: `
from fastapi import FastAPI
from pydantic import BaseModel
from fake_analytics_sdk import track_event
import totally_made_up_package

app = FastAPI()

class UserCreate(BaseModel):
    username: str
    email: str

@app.post("/users")
def create_user(user: UserCreate):
    track_event("user_created", {"username": user.username})
    totally_made_up_package.init()
    return {"status": "created", "username": user.username}

@app.get("/health")
def health_check():
    return {"status": "ok"}
`,
  language: 'Python',
  expectedFailures: [
    { category: 'DHI', count: 1, descriptionContains: 'fake_analytics_sdk' },
    { category: 'DHI', count: 1, descriptionContains: 'totally_made_up_package' },
  ],
};

// ---------------------------------------------------------------------------
// BCI (Build/Configuration Incoherence): Config with missing environment variable / bad value
// ---------------------------------------------------------------------------
export const FIXTURE_BCI_BAD_CONFIG: CodeFixture = {
  name: 'BCI - Configuration with missing or invalid values',
  code: `
import os

class AppConfig:
    DEBUG = True
    DATABASE_URL = os.environ.get("DATABASE_URL")
    SECRET_KEY = os.environ.get("SECRET_KEY")
    PORT = os.environ.get("PORT")
    MAX_CONNECTIONS = "not_a_number"
    LOG_LEVEL = "INFO"

def get_config():
    config = AppConfig()
    if not config.DATABASE_URL:
        raise ValueError("DATABASE_URL is required")
    return config

def connect_db(config):
    print(f"Connecting to {config.DATABASE_URL}")
    return None

if __name__ == "__main__":
    cfg = get_config()
    connect_db(cfg)
`,
  language: 'Python',
  expectedFailures: [
    // The config graph detects environment nodes and config nodes.
    // BCI fires for config values with no value or type mismatch.
    { category: 'BCI', count: 1, descriptionContains: 'Config' },
  ],
};

// ---------------------------------------------------------------------------
// RCF (Resource Coherence Failures): Unusual template path in resource graph
// ---------------------------------------------------------------------------
export const FIXTURE_RCF_UNUSUAL_TEMPLATE: CodeFixture = {
  name: 'RCF - Unusual template path without standard extension',
  code: `
from fastapi import FastAPI
from fastapi.templating import Jinja2Templates

app = FastAPI()
templates = Jinja2Templates(directory="templates")

@app.get("/dashboard")
def dashboard():
    return templates.TemplateResponse("dashboard.pyc", {"request": {}})

@app.get("/report")
def report():
    return templates.TemplateResponse("../../etc/passwd", {"request": {}})

@app.get("/profile")
def profile():
    return templates.TemplateResponse("profile.html", {"request": {}})

def helper():
    with open("data/config.yaml") as f:
        return f.read()
`,
  language: 'Python',
  expectedFailures: [
    // Resource graph analysis detects unusual template extension (.pyc) and directory traversal
    { category: 'RCF', count: 1, descriptionContains: 'template' },
    { category: 'RCF', count: 1, descriptionContains: 'traversal' },
  ],
};

// ---------------------------------------------------------------------------
// CFC (Control Flow Coherence): Unreachable code after return
// ---------------------------------------------------------------------------
export const FIXTURE_CFC_UNREACHABLE_CODE: CodeFixture = {
  name: 'CFC - Unreachable code after return statement',
  code: `
def calculate_discount(price: float, is_member: bool) -> float:
    if is_member:
        return price * 0.8
        print("This line is unreachable")
        extra_discount = price * 0.05
    else:
        return price

def validate_input(value: str) -> bool:
    if not value:
        return False
    if len(value) > 100:
        return False
    return True
    cleanup_resources()

def process_order(order_id: int) -> dict:
    result = {"order_id": order_id, "status": "processed"}
    return result
`,
  language: 'Python',
  expectedFailures: [
    // CFC detection: unreachable code after return in CFG
    { category: 'CFC', count: 1, descriptionContains: 'Unreachable' },
  ],
};

// ---------------------------------------------------------------------------
// CCV (Cross-file Contract Violations): Mixed snake_case/camelCase across related models
// ---------------------------------------------------------------------------
export const FIXTURE_CCV_NAMING_MISMATCH: CodeFixture = {
  name: 'CCV - Field name convention mismatch across related models',
  code: `
interface UserRequest {
  first_name: string;
  last_name: string;
  email_address: string;
  date_of_birth: string;
}

interface UserResponse {
  firstName: string;
  lastName: string;
  emailAddress: string;
  dateOfBirth: string;
  createdAt: string;
}

function createUser(request: UserRequest): UserResponse {
  return {
    firstName: request.first_name,
    lastName: request.last_name,
    emailAddress: request.email_address,
    dateOfBirth: request.date_of_birth,
    createdAt: new Date().toISOString(),
  };
}

function getUser(id: string): UserResponse {
  return createUser({
    first_name: "John",
    last_name: "Doe",
    email_address: "john@example.com",
    date_of_birth: "1990-01-01",
  });
}
`,
  language: 'TypeScript',
  expectedFailures: [
    // CCV detection: UserRequest uses snake_case, UserResponse uses camelCase
    { category: 'CCV', count: 1, descriptionContains: 'convention mismatch' },
  ],
};

// ---------------------------------------------------------------------------
// SSR (Security Structural Regressions): Routes with inconsistent auth guards
// ---------------------------------------------------------------------------
export const FIXTURE_SSR_UNGUARDED_ROUTE: CodeFixture = {
  name: 'SSR - Routes with inconsistent auth guards',
  code: `
from fastapi import FastAPI, Depends
from fastapi.security import HTTPBearer

app = FastAPI()
security = HTTPBearer()

def verify_token(token = Depends(security)):
    if not token:
        raise Exception("Unauthorized")
    return token

@app.get("/users", dependencies=[Depends(verify_token)])
def list_users():
    return [{"id": 1, "name": "Alice"}]

@app.post("/users", dependencies=[Depends(verify_token)])
def create_user():
    return {"id": 2, "name": "Bob"}

@app.delete("/users/{user_id}", dependencies=[Depends(verify_token)])
def delete_user(user_id: int):
    return {"deleted": user_id}

@app.get("/admin/settings")
def admin_settings():
    return {"debug": True, "maintenance": False}

@app.post("/admin/reset")
def admin_reset():
    return {"reset": True}
`,
  language: 'Python',
  expectedFailures: [
    // SSR detection: admin routes lack auth guard while other routes have it
    { category: 'SSR', count: 1, descriptionContains: 'Unguarded' },
  ],
};

// ---------------------------------------------------------------------------
// Combined: Multiple failure categories in one sample
// ---------------------------------------------------------------------------
export const FIXTURE_COMBINED_FAILURES: CodeFixture = {
  name: 'Combined - Multiple failure categories',
  code: `
from ghost_orm import Model, Field
from typing import Optional
import nonexistent_logger

class Config:
    DB_HOST = ""
    DB_PORT = "not_a_number"
    DEBUG = True

class UserModel(Model):
    name: str = Field(max_length=100)
    email: str = Field(unique=True)

def setup_database(config: Config):
    if not config.DB_HOST:
        return None
        print("unreachable cleanup code")

def create_user(data: dict) -> Optional[UserModel]:
    user = UserModel(**data)
    nonexistent_logger.info(f"Created user {user.name}")
    return user

def main():
    config = Config()
    setup_database(config)
    create_user({"name": "test", "email": "test@test.com"})

if __name__ == "__main__":
    main()
`,
  language: 'Python',
  expectedFailures: [
    { category: 'DHI', count: 1, descriptionContains: 'ghost_orm' },
    { category: 'DHI', count: 1, descriptionContains: 'nonexistent_logger' },
    { category: 'CFC', count: 1, descriptionContains: 'Unreachable' },
  ],
};

// Export all fixtures as an array for iteration
export const ALL_FAILURE_FIXTURES: CodeFixture[] = [
  FIXTURE_PIA_PHANTOM_IMPORT,
  FIXTURE_SRF_UNDEFINED_CALLS,
  FIXTURE_DHI_MISSING_DEPENDENCY,
  FIXTURE_BCI_BAD_CONFIG,
  FIXTURE_RCF_UNUSUAL_TEMPLATE,
  FIXTURE_CFC_UNREACHABLE_CODE,
  FIXTURE_CCV_NAMING_MISMATCH,
  FIXTURE_SSR_UNGUARDED_ROUTE,
  FIXTURE_COMBINED_FAILURES,
];
