#!/usr/bin/env python3
"""
Submit URLs to IndexNow (Bing, Yandex, Seznam, Naver).

Usage:
    # Submit specific URLs
    python3 scripts/indexnow_submit.py https://holisticunity.app/thetahealing.html https://holisticunity.app/

    # Submit all URLs from sitemap.xml
    python3 scripts/indexnow_submit.py --sitemap

Run after every deploy that changes content. Quota: ~10,000 URLs/day per host.
Endpoint accepts up to 10,000 URLs per POST.
"""
import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

HOST = "holisticunity.app"
KEY = "1e88c1c8a5c297b7219332e0ab88e974236f0d2cb9974f1f48646d072ff3aeb4"
KEY_LOCATION = f"https://{HOST}/{KEY}.txt"
ENDPOINT = "https://api.indexnow.org/IndexNow"
SITEMAP_PATH = Path(__file__).parent.parent / "sitemap.xml"


def urls_from_sitemap() -> list[str]:
    text = SITEMAP_PATH.read_text(encoding="utf-8")
    return re.findall(r"<loc>([^<]+)</loc>", text)


def submit(urls: list[str]) -> int:
    payload = {
        "host": HOST,
        "key": KEY,
        "keyLocation": KEY_LOCATION,
        "urlList": urls,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"HTTP {resp.status} — {len(urls)} URL(s) submitted")
            return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} — {e.reason}")
        print(e.read().decode("utf-8", errors="replace"))
        return 1


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    if argv[1] == "--sitemap":
        urls = urls_from_sitemap()
        if not urls:
            print(f"No URLs found in {SITEMAP_PATH}")
            return 1
        print(f"Submitting {len(urls)} URLs from sitemap.xml")
    else:
        urls = argv[1:]
    return submit(urls)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
