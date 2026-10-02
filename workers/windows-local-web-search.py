# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "ddgs>=9.6.0",
# ]
# ///

"""Opt-in web search helper for CoOperative Personal AI."""

from __future__ import annotations

import json
import sys

from ddgs import DDGS


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: windows-local-web-search.py <query>")
    query = " ".join(sys.argv[1:]).strip()
    if not query:
        raise RuntimeError("Search query is empty.")

    rows = []
    ddgs = DDGS(timeout=10)
    for result in ddgs.text(query, max_results=6):
        if not isinstance(result, dict):
            continue
        title = str(result.get("title") or "").strip()
        href = str(result.get("href") or result.get("url") or "").strip()
        body = str(result.get("body") or result.get("snippet") or "").strip()
        if href:
            rows.append({"title": title[:240], "url": href[:1200], "snippet": body[:1200]})
    print(json.dumps({"query": query, "results": rows}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)[:800]}))
        raise SystemExit(1)
