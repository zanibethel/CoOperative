# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "ddgs>=9.6.0",
# ]
# ///

"""Opt-in web search helper for CoOperative Personal AI."""

from __future__ import annotations

import ipaddress
import json
import re
import sys
from urllib.parse import urlparse

from ddgs import DDGS


EXECUTABLE_EXTENSIONS = {
    ".exe", ".msi", ".msix", ".appx", ".dmg", ".pkg", ".deb", ".rpm",
    ".bat", ".cmd", ".ps1", ".scr", ".com", ".jar",
}


def public_result_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    if parsed.username or parsed.password:
        return False

    host = parsed.hostname.lower().rstrip(".")
    if host in {"localhost"} or host.endswith((".localhost", ".local", ".internal")):
        return False

    try:
        ip = ipaddress.ip_address(host)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_unspecified
            or ip.is_reserved
        ):
            return False
    except ValueError:
        pass

    lower_path = parsed.path.lower()
    if any(lower_path.endswith(extension) for extension in EXECUTABLE_EXTENSIONS):
        return False

    sensitive = {
        "access_token", "api_key", "apikey", "authorization", "code",
        "credential", "key", "password", "refresh_token", "secret", "token",
    }
    query_pairs = [part.split("=", 1)[0].lower() for part in parsed.query.split("&") if part]
    if any(key in sensitive for key in query_pairs):
        return False
    if any(f"{key}=" in parsed.fragment.lower() for key in sensitive):
        return False
    return True


SENSITIVE_QUERY_PATTERNS = (
    re.compile(
        r"(?i)\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|"
        r"bearer|password|secret|credential)\b\s*[:=]?\s*\S+"
    ),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
)


def query_is_safe_for_external_search(query: str) -> bool:
    return not any(pattern.search(query) for pattern in SENSITIVE_QUERY_PATTERNS)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: windows-local-web-search.py <query>")
    query = " ".join(sys.argv[1:]).strip()
    if not query:
        raise RuntimeError("Search query is empty.")
    if not query_is_safe_for_external_search(query):
        print(
            json.dumps(
                {
                    "query": "",
                    "results": [],
                    "blocked": True,
                    "reason": "credential-like-content",
                }
            )
        )
        return

    rows = []
    ddgs = DDGS(timeout=10)
    for result in ddgs.text(query, max_results=6):
        if not isinstance(result, dict):
            continue
        title = str(result.get("title") or "").strip()
        href = str(result.get("href") or result.get("url") or "").strip()
        body = str(result.get("body") or result.get("snippet") or "").strip()
        if href and public_result_url(href):
            rows.append({"title": title[:240], "url": href[:1200], "snippet": body[:1200]})
    print(json.dumps({"query": query, "results": rows}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)[:800]}))
        raise SystemExit(1)
