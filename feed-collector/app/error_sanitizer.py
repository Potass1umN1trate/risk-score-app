"""
Safe error formatting for feed collector logs, results, and audit details.
"""

import re

_DEFAULT_ERROR = "Unknown error."

_DB_URL_RE = re.compile(r"\b(?:postgresql|postgres)://[^\s'\"<>]+", re.IGNORECASE)
_AUTH_HEADER_RE = re.compile(
    r"\b(Authorization\s*[:=]\s*)(?:Bearer\s+|Basic\s+)?[^\s,;'\"]+",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT_RE = re.compile(
    r"\b([A-Z0-9_]*(?:api[_-]?key|token|password|secret)[A-Z0-9_]*\s*[:=]\s*)"
    r"([^\s,;&'\"<>]+)",
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s+")


def sanitize_error(exc_or_message: object, *, max_length: int = 500) -> str:
    """
    Return a bounded, single-line, secret-redacted error message.

    Tracebacks are intentionally omitted. Exceptions include their type name plus
    their message; plain strings are sanitized directly.
    """
    if max_length < 1:
        max_length = 1

    if isinstance(exc_or_message, BaseException):
        message = str(exc_or_message)
        text = (
            f"{type(exc_or_message).__name__}: {message}"
            if message
            else type(exc_or_message).__name__
        )
    else:
        text = str(exc_or_message)

    text = _redact(text)
    text = _omit_large_body(text)
    text = _WHITESPACE_RE.sub(" ", text).strip()

    if not text:
        text = _DEFAULT_ERROR

    if len(text) > max_length:
        suffix = " ... [truncated]"
        if max_length <= len(suffix):
            text = text[:max_length]
        else:
            text = text[: max_length - len(suffix)].rstrip() + suffix

    return text or _DEFAULT_ERROR[:max_length]


def _redact(text: str) -> str:
    text = _DB_URL_RE.sub("[REDACTED_DATABASE_URL]", text)
    text = _AUTH_HEADER_RE.sub(r"\1[REDACTED_AUTHORIZATION]", text)
    text = _SECRET_ASSIGNMENT_RE.sub(r"\1[REDACTED_SECRET]", text)
    return text


def _omit_large_body(text: str) -> str:
    stripped = text.lstrip()
    looks_like_json = stripped.startswith("{") or stripped.startswith("[")
    looks_like_xml = stripped.startswith("<") or "<?xml" in stripped[:100].lower()
    if len(text) > 1000 and (looks_like_json or looks_like_xml):
        return "Large response body omitted."
    return text
