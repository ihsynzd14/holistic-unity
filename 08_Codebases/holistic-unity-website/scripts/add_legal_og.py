#!/usr/bin/env python3
"""
add_legal_og.py — OpenGraph + structured data for the legal pages (SEO Fix #1).

The 4 legal pages (privacy-policy is indexed; terms-*/cookie are noindex) use a
separate translation system and were never prerendered, so they lack og:title,
og:description and JSON-LD. Title + meta description already exist; this derives
OG/Twitter from them and adds a WebPage schema. Idempotent.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://holisticunity.app"
PAGES = ["privacy-policy.html", "terms-clients.html",
         "terms-therapists.html", "cookie-policy.html"]
OG_IMAGE = f"{SITE}/images/og-image.jpg"


def grab(text, pattern):
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def main():
    for name in PAGES:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        text = open(path, encoding="utf-8").read()
        if 'property="og:title"' in text:
            print(f"  {name}: already has OG — skipped")
            continue
        title = grab(text, r"<title>(.*?)</title>")
        desc = grab(text, r'<meta\s+name="description"\s+content="([^"]*)"')
        canon = grab(text, r'<link[^>]*rel="canonical"[^>]*href="([^"]*)"') \
            or grab(text, r'<link[^>]*href="([^"]*)"[^>]*rel="canonical"') \
            or f"{SITE}/{name[:-5]}"
        lang = grab(text, r'<html\s+lang="([\w-]+)"') or "en"
        locale = {"it": "it_IT", "en": "en_US", "pt": "pt_BR"}.get(lang, "en_US")

        og = (
            f'  <meta property="og:type" content="website">\n'
            f'  <meta property="og:url" content="{canon}">\n'
            f'  <meta property="og:title" content="{title}">\n'
            f'  <meta property="og:description" content="{desc}">\n'
            f'  <meta property="og:image" content="{OG_IMAGE}">\n'
            f'  <meta property="og:site_name" content="Holistic Unity">\n'
            f'  <meta property="og:locale" content="{locale}">\n'
            f'  <meta name="twitter:card" content="summary_large_image">\n'
            f'  <meta name="twitter:title" content="{title}">\n'
            f'  <meta name="twitter:description" content="{desc}">\n'
            f'  <meta name="twitter:image" content="{OG_IMAGE}">\n'
        )
        jsonld = (
            '  <script type="application/ld+json">\n'
            '  {\n'
            '    "@context": "https://schema.org",\n'
            '    "@type": "WebPage",\n'
            f'    "name": {jstr(title)},\n'
            f'    "description": {jstr(desc)},\n'
            f'    "url": {jstr(canon)},\n'
            f'    "inLanguage": "{lang}",\n'
            '    "isPartOf": { "@type": "WebSite", "name": "Holistic Unity", '
            f'"url": "{SITE}" }},\n'
            '    "publisher": { "@type": "Organization", "name": "Holistic Unity", '
            f'"url": "{SITE}" }}\n'
            '  }\n'
            '  </script>\n'
        )
        # insert right after the meta description line
        m = re.search(r'<meta\s+name="description"[^>]*>\s*\n', text, re.IGNORECASE)
        if not m:
            print(f"  {name}: no <meta description> anchor — skipped")
            continue
        text = text[:m.end()] + og + jsonld + text[m.end():]
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        print(f"  {name}: added OG + WebPage JSON-LD (lang={lang})")


def jstr(s):
    import json
    return json.dumps(s, ensure_ascii=False)


if __name__ == "__main__":
    main()
