from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import os
import re
from typing import Any, Callable
from uuid import uuid4

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

ACCESS_TOKEN_TTL_MINUTES = int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "15"))
REFRESH_TOKEN_TTL_DAYS = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30"))
AUDIO_TOKEN_TTL_MINUTES = int(os.getenv("AUDIO_TOKEN_TTL_MINUTES", "10"))

ACCESS_TOKEN_SECRET = os.getenv("ACCESS_TOKEN_SECRET", "")
REFRESH_TOKEN_SECRET = os.getenv("REFRESH_TOKEN_SECRET", "")
AUDIO_TOKEN_SECRET = os.getenv("AUDIO_TOKEN_SECRET", "") or ACCESS_TOKEN_SECRET
AUTH_DEFAULT_USER = os.getenv("AUTH_DEFAULT_USER", "")
AUTH_DEFAULT_PASSWORD_HASH = os.getenv("AUTH_DEFAULT_PASSWORD_HASH", "")
AUTH_DEFAULT_PASSWORD = os.getenv("AUTH_DEFAULT_PASSWORD", "")
ADMIN_USERS = {u.strip() for u in os.getenv("ADMIN_USERS", "").split(",") if u.strip()}

REFRESH_TOKEN_STORE: dict[str, dict[str, Any]] = {}


def _access_token_secret() -> str:
    return os.getenv("ACCESS_TOKEN_SECRET", ACCESS_TOKEN_SECRET)


def _refresh_token_secret() -> str:
    return os.getenv("REFRESH_TOKEN_SECRET", REFRESH_TOKEN_SECRET)


def _audio_token_secret() -> str:
    env_value = os.getenv("AUDIO_TOKEN_SECRET")
    if env_value:
        return env_value
    return _access_token_secret()


def _auth_default_user() -> str:
    return os.getenv("AUTH_DEFAULT_USER", AUTH_DEFAULT_USER)


def _auth_default_password_hash() -> str:
    return os.getenv("AUTH_DEFAULT_PASSWORD_HASH", AUTH_DEFAULT_PASSWORD_HASH)


def _auth_default_password() -> str:
    return os.getenv("AUTH_DEFAULT_PASSWORD", AUTH_DEFAULT_PASSWORD)


def _admin_users() -> set[str]:
    raw = os.getenv("ADMIN_USERS")
    if raw is None:
        return ADMIN_USERS
    return {u.strip() for u in raw.split(",") if u.strip()}


class AuthError(HTTPException):
    def __init__(self, detail: str, status_code: int = status.HTTP_401_UNAUTHORIZED) -> None:
        super().__init__(status_code=status_code, detail=detail)


@dataclass
class AuthContext:
    user_id: str
    roles: list[str]
    scopes: list[str]


def _require_secrets() -> None:
    if not _access_token_secret() or not _refresh_token_secret():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth secrets not configured.",
        )


def verify_password(username: str, password: str) -> bool:
    auth_user = _auth_default_user()
    auth_hash = _auth_default_password_hash()
    auth_password = _auth_default_password()
    if not auth_user or not (auth_hash or auth_password):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth credentials not configured.",
        )
    if username != auth_user:
        return False
    if auth_hash:
        return pwd_context.verify(password, auth_hash)
    logger.warning("Using plaintext auth password; set AUTH_DEFAULT_PASSWORD_HASH.")
    return auth_password == password


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode_jwt(payload: dict[str, Any], secret: str) -> str:
    return jwt.encode(payload, secret, algorithm="HS256")


def _decode_jwt(token: str, secret: str) -> dict[str, Any]:
    return jwt.decode(token, secret, algorithms=["HS256"])


def issue_tokens(user_id: str, roles: list[str], scopes: list[str]) -> dict[str, Any]:
    _require_secrets()
    issued_at = _now()
    access_exp = issued_at + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)
    refresh_exp = issued_at + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    access_payload = {
        "sub": user_id,
        "roles": roles,
        "scopes": scopes,
        "type": "access",
        "iat": int(issued_at.timestamp()),
        "exp": int(access_exp.timestamp()),
    }
    refresh_jti = uuid4().hex
    refresh_payload = {
        "sub": user_id,
        "roles": roles,
        "scopes": scopes,
        "type": "refresh",
        "jti": refresh_jti,
        "iat": int(issued_at.timestamp()),
        "exp": int(refresh_exp.timestamp()),
    }
    refresh_token = _encode_jwt(refresh_payload, _refresh_token_secret())
    REFRESH_TOKEN_STORE[refresh_jti] = {
        "user_id": user_id,
        "expires_at": refresh_exp,
    }
    return {
        "access_token": _encode_jwt(access_payload, _access_token_secret()),
        "access_expires_at": access_exp,
        "refresh_token": refresh_token,
        "refresh_expires_at": refresh_exp,
        "refresh_jti": refresh_jti,
    }


def rotate_refresh_token(refresh_token: str) -> dict[str, Any]:
    _require_secrets()
    payload = _decode_jwt(refresh_token, _refresh_token_secret())
    if payload.get("type") != "refresh":
        raise AuthError("Invalid refresh token type.")
    jti = payload.get("jti")
    if not jti or jti not in REFRESH_TOKEN_STORE:
        raise AuthError("Refresh token revoked.")
    stored = REFRESH_TOKEN_STORE.get(jti)
    if stored and stored["expires_at"] < _now():
        REFRESH_TOKEN_STORE.pop(jti, None)
        raise AuthError("Refresh token expired.")
    REFRESH_TOKEN_STORE.pop(jti, None)
    return issue_tokens(
        user_id=str(payload.get("sub")),
        roles=list(payload.get("roles") or []),
        scopes=list(payload.get("scopes") or []),
    )


def revoke_refresh_token(refresh_token: str) -> None:
    _require_secrets()
    try:
        payload = _decode_jwt(refresh_token, _refresh_token_secret())
    except jwt.PyJWTError:
        return
    jti = payload.get("jti")
    if jti:
        REFRESH_TOKEN_STORE.pop(jti, None)


def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthContext:
    _require_secrets()
    if not credentials or credentials.scheme.lower() != "bearer":
        raise AuthError("Missing access token.")
    token = credentials.credentials
    try:
        payload = _decode_jwt(token, _access_token_secret())
    except jwt.PyJWTError:
        raise AuthError("Invalid access token.")
    if payload.get("type") != "access":
        raise AuthError("Invalid access token type.")
    return AuthContext(
        user_id=str(payload.get("sub")),
        roles=list(payload.get("roles") or []),
        scopes=list(payload.get("scopes") or []),
    )


def require_roles(*roles: str) -> Callable[[AuthContext], AuthContext]:
    def _checker(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if not roles:
            return ctx
        if not set(roles).intersection(ctx.roles):
            raise AuthError("Insufficient role.", status_code=status.HTTP_403_FORBIDDEN)
        return ctx

    return _checker


def require_scopes(*scopes: str) -> Callable[[AuthContext], AuthContext]:
    def _checker(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if not scopes:
            return ctx
        missing = [scope for scope in scopes if scope not in ctx.scopes]
        if missing:
            raise AuthError("Insufficient scope.", status_code=status.HTTP_403_FORBIDDEN)
        return ctx

    return _checker


def get_default_roles(username: str) -> list[str]:
    if username in _admin_users():
        return ["admin", "user"]
    return ["user"]


def create_audio_token(filename: str) -> str:
    audio_secret = _audio_token_secret()
    if not audio_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Audio token secret not configured.",
        )
    issued_at = _now()
    exp = issued_at + timedelta(minutes=AUDIO_TOKEN_TTL_MINUTES)
    payload = {
        "type": "audio",
        "file": filename,
        "iat": int(issued_at.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return _encode_jwt(payload, audio_secret)


def verify_audio_token(token: str, filename: str) -> None:
    try:
        payload = _decode_jwt(token, _audio_token_secret())
    except jwt.PyJWTError:
        raise AuthError("Invalid audio token.")
    if payload.get("type") != "audio" or payload.get("file") != filename:
        raise AuthError("Invalid audio token.")


class RedactFilter(logging.Filter):
    _pattern = re.compile(r"(Bearer\s+)[A-Za-z0-9\-._~+/]+=*|refresh_token=([^;\\s]+)")

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self._pattern.sub(r"\\1[REDACTED]", record.msg)
        if record.args:
            record.args = tuple(
                self._pattern.sub(r"\\1[REDACTED]", str(arg)) for arg in record.args
            )
        return True


def add_redaction_filter() -> None:
    root = logging.getLogger()
    root.addFilter(RedactFilter())
