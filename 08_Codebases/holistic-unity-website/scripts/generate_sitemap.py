#!/usr/bin/env python3
"""
generate_sitemap.py — trilingual sitemap for the prerendered site (S1)

Emits one <url> per page PER LANGUAGE (it = bare, en = /en, pt = /pt), each with
the full xhtml:link hreflang cluster (it / en / pt / x-default). Per-page
lastmod / changefreq / priority are carried over from the previous sitemap.xml
where available, so the editorial dates are preserved.

Legal pages keep their existing single-URL treatment (privacy-policy only;
cookie-policy + terms-* stay excluded because they are noindex).

Run from the site root:  python scripts/generate_sitemap.py
"""
import os
import re
import glob
import datetime
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_src")
SITE = "https://holisticunity.app"
LANGS = ["it", "en", "pt"]
DEFAULT_LANG = "it"
TODAY = datetime.date.today().isoformat()

# Legal page that stays single-language + indexed (kept from the old sitemap).
SINGLE_PAGES = ["privacy-policy"]


def url_path(rel):
    rel = rel.replace("\\", "/")
    if rel.endswith("index.html"):
        return rel[:-len("index.html")]
    if rel.endswith(".html"):
        return rel[:-5]
    return rel


def lang_loc(path, lang):
    prefix = "" if lang == DEFAULT_LANG else f"{lang}/"
    return f"{SITE}/{prefix}{path}"


def priority_for(path):
    if path == "":
        return "1.0"
    if path == "blog/":
        return "0.7"
    if path.startswith("blog/"):
        return "0.8"
    if path == "about":
        return "0.8"
    return "0.9"          # modality pages


def load_old_meta():
    """Map bare clean-path -> (lastmod, changefreq, priority) from old sitemap."""
    meta = {}
    old = os.path.join(ROOT, "sitemap.xml")
    if not os.path.exists(old):
        return meta
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    try:
        tree = ET.parse(old)
    except ET.ParseError:
        return meta
    for url in tree.getroot().findall("s:url", ns):
        loc = url.findtext("s:loc", default="", namespaces=ns)
        path = loc.replace(SITE + "/", "")
        meta[path] = (
            url.findtext("s:lastmod", default=TODAY, namespaces=ns),
            url.findtext("s:changefreq", default="monthly", namespaces=ns),
            url.findtext("s:priority", default=priority_for(path), namespaces=ns),
        )
    return meta


def url_block(path, lastmod, changefreq, priority):
    """One <url> per language, each carrying the full hreflang cluster."""
    alts = "".join(
        f'    <xhtml:link rel="alternate" hreflang="{code}" href="{href}" />\n'
        for code, href in (
            ("it", lang_loc(path, "it")),
            ("en", lang_loc(path, "en")),
            ("pt", lang_loc(path, "pt")),
            ("x-default", lang_loc(path, DEFAULT_LANG)),
        )
    )
    blocks = []
    for lang in LANGS:
        blocks.append(
            f"  <url>\n"
            f"    <loc>{lang_loc(path, lang)}</loc>\n"
            f"    <lastmod>{lastmod}</lastmod>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            f"{alts}"
            f"  </url>\n"
        )
    return "".join(blocks)


def main():
    old = load_old_meta()
    rels = [os.path.relpath(f, SRC).replace("\\", "/")
            for f in glob.glob(os.path.join(SRC, "*.html"))
            + glob.glob(os.path.join(SRC, "blog", "*.html"))]
    # order: home, about, modality, blog index, blog posts
    def sort_key(rel):
        p = url_path(rel)
        bucket = (0 if p == "" else 1 if p == "about" else
                  3 if p == "blog/" else 4 if p.startswith("blog/") else 2)
        return (bucket, p)
    rels.sort(key=sort_key)

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
           '        xmlns:xhtml="http://www.w3.org/1999/xhtml">', ""]

    n = 0
    for rel in rels:
        path = url_path(rel)
        lastmod, changefreq, priority = old.get(
            path, (TODAY, "monthly", priority_for(path)))
        out.append(url_block(path, lastmod, changefreq, priority).rstrip("\n"))
        n += 1

    # single-language indexed legal page(s)
    for slug in SINGLE_PAGES:
        lastmod, changefreq, priority = old.get(slug, (TODAY, "yearly", "0.5"))
        out.append(
            f"  <url>\n    <loc>{SITE}/{slug}</loc>\n"
            f"    <lastmod>{lastmod}</lastmod>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n  </url>")

    out.append("")
    out.append("</urlset>")
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8", newline="") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"sitemap.xml: {n} pages × {len(LANGS)} langs + {len(SINGLE_PAGES)} legal "
          f"= {n*len(LANGS)+len(SINGLE_PAGES)} <url> entries")


if __name__ == "__main__":
    main()
