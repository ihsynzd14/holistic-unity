#!/usr/bin/env python3
"""fix_legal_pages.py — pre-deploy cleanup of the 4 standalone legal pages.

  - add a static <title> where missing (cookie/terms had none → also fixed the
    empty og:title my earlier legal-OG pass produced)
  - add canonical where missing (privacy-policy)
  - backfill empty og/twitter/JSON-LD content from title + meta description
  - make the render-blocking Google Fonts link async (preload + media-swap)
Idempotent.
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://holisticunity.app"
TITLES = {
    "privacy-policy.html": "Privacy Policy — Holistic Unity",
    "cookie-policy.html": "Cookie Policy — Holistic Unity",
    "terms-clients.html": "Terms & Conditions for Clients — Holistic Unity",
    "terms-therapists.html": "Terms & Conditions for Practitioners — Holistic Unity",
}


def main():
    for name, title in TITLES.items():
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        h = open(path, encoding="utf-8").read()
        slug = name[:-5]
        desc_m = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', h, re.I)
        desc = desc_m.group(1) if desc_m else ""

        # 1) <title>
        if re.search(r"<title>\s*</title>", h, re.I):
            h = re.sub(r"<title>\s*</title>", f"<title>{title}</title>", h, count=1, flags=re.I)
        elif not re.search(r"<title>.+?</title>", h, re.S | re.I):
            anchor = re.search(r'(<meta\s+name="viewport"[^>]*>)', h, re.I)
            if anchor:
                h = h[:anchor.end()] + f"\n  <title>{title}</title>" + h[anchor.end():]

        # 2) canonical
        if not re.search(r'rel="canonical"', h, re.I):
            anchor = re.search(r"</title>", h, re.I)
            if anchor:
                h = h[:anchor.end()] + f'\n  <link rel="canonical" href="{SITE}/{slug}">' + h[anchor.end():]

        # 3) backfill empty OG/Twitter content + JSON-LD name/description
        def fill(pattern, value):
            return re.sub(pattern + r'\s+content=""',
                          lambda m: m.group(0).replace('content=""', f'content="{value}"'), h2[0], flags=re.I)
        h2 = [h]
        for prop, val in (('property="og:title"', title), ('name="twitter:title"', title),
                          ('property="og:description"', desc), ('name="twitter:description"', desc)):
            h2[0] = fill(prop, val)
        h = h2[0]
        h = h.replace('"name": ""', f'"name": {jstr(title)}')
        h = h.replace('"description": ""', f'"description": {jstr(desc)}')

        # 4) async the render-blocking Google Fonts link (keep its URL)
        fm = re.search(r'<link\b(?![^>]*media=)[^>]*fonts\.googleapis\.com/css[^>]*rel="stylesheet"[^>]*>'
                       r'|<link\b(?![^>]*media=)[^>]*rel="stylesheet"[^>]*fonts\.googleapis\.com/css[^>]*>', h, re.I)
        if fm:
            url = re.search(r'href="([^"]+)"', fm.group(0)).group(1)
            block = (f'<link rel="preload" as="style" href="{url}">\n'
                     f'  <link rel="stylesheet" href="{url}" media="print" onload="this.media=\'all\'">\n'
                     f'  <noscript><link rel="stylesheet" href="{url}"></noscript>')
            h = h[:fm.start()] + block + h[fm.end():]

        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(h)
        print(f"  fixed {name}")


def jstr(s):
    import json
    return json.dumps(s, ensure_ascii=False)


if __name__ == "__main__":
    main()
