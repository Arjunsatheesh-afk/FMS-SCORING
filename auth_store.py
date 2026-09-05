"""SQLite-backed accounts and sessions for the PhysioTracking prototype.

Accounts are identified by email address. Two roles exist: 'doctor' and
'patient'. Doctors register patients, which is why a patient row records the
doctor that created it.

PROTOTYPE SECURITY - NOT PRODUCTION
-----------------------------------
Every account is created with a default password derived from its phone
number (see `default_password_for`). That is a deliberate shortcut so a doctor
can register a patient and tell them their password without a delivery
channel; it also means anyone who knows a user's phone number can sign in as
them until that user changes it. Passwords are PBKDF2-HMAC-SHA256 rather than
argon2/bcrypt, the database is not encrypted at rest, and tokens are opaque
random strings with no refresh or revocation beyond logout. Fine for a
prototype with test accounts; all of it must change before real patient data.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).parent
DB_PATH = Path(os.getenv("PHYSIO_DB_PATH", str(SCRIPT_DIR / "physio.db")))

PBKDF2_ITERATIONS = 200_000
TOKEN_TTL_DAYS = 30
ROLES = ("doctor", "patient")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_lock = threading.Lock()


class AuthError(Exception):
    """Raised for any caller-correctable problem (bad input, bad password)."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _lock, _connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt          TEXT NOT NULL,
                role          TEXT NOT NULL CHECK (role IN ('doctor', 'patient')),
                display_name  TEXT NOT NULL,
                phone_number  TEXT NOT NULL,
                created_by    INTEGER REFERENCES users(id),
                created_at    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS auth_tokens (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);
            CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);
            """
        )


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def default_password_for(phone_number: str) -> str:
    """PROTOTYPE ONLY: '<phone>.physio', e.g. 9876543210.physio.

    Documented in the README's known-limitations section. Anyone who knows the
    phone number can sign in until the account holder changes their password.
    """
    return f"{(phone_number or '').strip()}.physio"


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    ).hex()


def _row_to_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "role": row["role"],
        "displayName": row["display_name"],
        "phoneNumber": row["phone_number"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
    }


def create_user(
    *,
    email: str,
    role: str,
    display_name: str,
    phone_number: str,
    password: str | None = None,
    created_by: int | None = None,
) -> dict[str, Any]:
    """Create an account. Password defaults to '<phone>.physio' (prototype)."""
    email = normalize_email(email)
    display_name = (display_name or "").strip()
    phone_number = (phone_number or "").strip()

    if not EMAIL_RE.match(email):
        raise AuthError("A valid email address is required")
    if role not in ROLES:
        raise AuthError(f"role must be one of {ROLES}")
    if not display_name:
        raise AuthError("display name is required")
    if not phone_number:
        # Required for every role: the default password is derived from it.
        raise AuthError("phone number is required")

    password = password or default_password_for(phone_number)
    salt = secrets.token_bytes(16)

    with _lock, _connect() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE email = ? COLLATE NOCASE", (email,)
        ).fetchone()
        if existing is not None:
            raise AuthError(f"An account already exists for {email}")

        cursor = connection.execute(
            """
            INSERT INTO users
                (email, password_hash, salt, role, display_name, phone_number, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                email,
                _hash_password(password, salt),
                salt.hex(),
                role,
                display_name,
                phone_number,
                created_by,
                _utc_now().isoformat(),
            ),
        )
        row = connection.execute(
            "SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return _row_to_user(row)


def verify_credentials(email: str, password: str) -> dict[str, Any] | None:
    """Return the user for valid credentials, else None (never says which failed)."""
    email = normalize_email(email)
    with _lock, _connect() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email,)
        ).fetchone()
    if row is None:
        return None
    candidate = _hash_password(password or "", bytes.fromhex(row["salt"]))
    if not secrets.compare_digest(candidate, row["password_hash"]):
        return None
    return _row_to_user(row)


def create_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = _utc_now()
    with _lock, _connect() as connection:
        connection.execute(
            "INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (
                token,
                user_id,
                now.isoformat(),
                (now + timedelta(days=TOKEN_TTL_DAYS)).isoformat(),
            ),
        )
    return token


def user_for_token(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    with _lock, _connect() as connection:
        row = connection.execute(
            """
            SELECT users.*, auth_tokens.expires_at AS token_expires
            FROM auth_tokens
            JOIN users ON users.id = auth_tokens.user_id
            WHERE auth_tokens.token = ?
            """,
            (token,),
        ).fetchone()
    if row is None:
        return None
    if datetime.fromisoformat(row["token_expires"]) < _utc_now():
        delete_token(token)
        return None
    return _row_to_user(row)


def delete_token(token: str) -> None:
    with _lock, _connect() as connection:
        connection.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))


def change_password(user_id: int, current_password: str, new_password: str, *, keep_token: str | None = None) -> None:
    """Verify the current password, then replace it.

    Requiring the current password is what stops a stolen token from locking
    the real owner out. Other sessions are invalidated on success.
    """
    if not new_password or len(new_password) < 6:
        raise AuthError("New password must be at least 6 characters")

    with _lock, _connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise AuthError("Account not found")

        candidate = _hash_password(current_password or "", bytes.fromhex(row["salt"]))
        if not secrets.compare_digest(candidate, row["password_hash"]):
            raise AuthError("Current password is incorrect")

        salt = secrets.token_bytes(16)
        connection.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (_hash_password(new_password, salt), salt.hex(), user_id),
        )
        if keep_token:
            connection.execute(
                "DELETE FROM auth_tokens WHERE user_id = ? AND token != ?", (user_id, keep_token)
            )
        else:
            connection.execute("DELETE FROM auth_tokens WHERE user_id = ?", (user_id,))


def list_patients_for_doctor(doctor_id: int) -> list[dict[str, Any]]:
    with _lock, _connect() as connection:
        rows = connection.execute(
            """
            SELECT * FROM users
            WHERE role = 'patient' AND created_by = ?
            ORDER BY display_name COLLATE NOCASE
            """,
            (doctor_id,),
        ).fetchall()
    return [_row_to_user(row) for row in rows]


def get_user(user_id: int) -> dict[str, Any] | None:
    with _lock, _connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row) if row else None
