#!/usr/bin/env python3
"""
RSS feed generator for Holistic Unity blog.

Reads all .html files in /blog/ (except index.html and this script's dir),
extracts metadata from each post, and generates blog/feed.xml.

Run from project root:
    python3 blog/_generate_rss.py

Or from blog/:
    python3 _generate_rss.py

Called automatically by the daily scheduled task after each new post.
"""

import os
import re
import sys
from pathlib import Path
from datetime import datetime, timezone
from html import escape
from xml.sax.saxutils import escape as xml_escape

# Resolve project root (where this script lives)
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BLOG_DIR = SCRIPT_DIR
SITE_URL = "https://holisticunity.app"
FEED_PATH = BLOG_DIR / "feed.xml"

EXCLUDE = {"index.html"}


def extract_meta(html: str, name: str, prop: bool = False) -> str:
    """Extract a meta tag value. If prop=True, use property= instead of name="""
    attr = "property" if prop else "name"
    pattern = rf'<meta\s+{attr}="{re.escape(name)}"\s+content="([^"]*)"'
    m = re.search(pattern, html, re.IGNORECASE)
    if m:
        return m.group(1)
    # Try reversed attribute order
    pattern = rf'<meta\s+content="([^"]*)"\s+{attr}="{re.escape(name)}"'
    m = re.search(pattern, html, re.IGNORECASE)
    if m:
        return m.group(1)
    return ""


def extract_title(html: str) -> str:
    m = re.search(r"<title>([^<]+)</title>", html, re.IGNORECASE)
    if m:
        return m.group(1).replace(" | Holistic Unity", "").strip()
    # Fallback to og:title
    return extract_meta(html, "og:title", prop=True)


def extract_pub_date(html: str) -> datetime:
    """Try article:published_time meta, then BlogPosting JSON-LD datePublished, else now."""
    pub = extract_meta(html, "article:published_time", prop=True)
    if pub:
        try:
            return datetime.fromisoformat(pub.replace("Z", "+00:00"))
        except ValueError:
            pass
    # Try JSON-LD
    m = re.search(r'"datePublished":\s*"([^"]+)"', html)
    if m:
        try:
            return datetime.fromisoformat(m.group(1).replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def rfc822(dt: datetime) -> str:
    """RSS requires RFC 822 date format."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%a, %d %b %Y %H:%M:%S %z")


def collect_posts():
    posts = []
    for path in sorted(BLOG_DIR.glob("*.html")):
        if path.name in EXCLUDE or path.name.startswith("_"):
            continue
        html = path.read_text(encoding="utf-8")
        title = extract_title(html)
        description = extract_meta(html, "description")
        og_image = extract_meta(html, "og:image", prop=True)
        author = extract_meta(html, "author") or "Holistic Unity"
        section = extract_meta(html, "article:section", prop=True) or "Wellness"
        pub_date = extract_pub_date(html)
        slug = path.stem
        url = f"{SITE_URL}/blog/{path.name}"
        posts.append({
            "title": title,
            "description": description,
            "url": url,
            "image": og_image,
            "author": author,
            "category": section,
            "pub_date": pub_date,
            "guid": url,
        })
    # Newest first
    posts.sort(key=lambda p: p["pub_date"], reverse=True)
    return posts


def build_feed(posts) -> str:
    now = datetime.now(timezone.utc)
    latest_build = posts[0]["pub_date"] if posts else now

    items = []
    for p in posts:
        item = f"""    <item>
      <title>{xml_escape(p['title'])}</title>
      <link>{p['url']}</link>
      <guid isPermaLink="true">{p['guid']}</guid>
      <pubDate>{rfc822(p['pub_date'])}</pubDate>
      <description>{xml_escape(p['description'])}</description>
      <category>{xml_escape(p['category'])}</category>
      <dc:creator>{xml_escape(p['author'])}</dc:creator>"""
        if p['image']:
            item += f"""
      <enclosure url="{xml_escape(p['image'])}" type="image/jpeg" length="0" />
      <media:content url="{xml_escape(p['image'])}" medium="image" />"""
        item += "\n    </item>"
        items.append(item)

    items_xml = "\n".join(items)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Holistic Unity Blog</title>
    <link>{SITE_URL}/blog/</link>
    <atom:link href="{SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>Honest guides to holistic therapies — ThetaHealing®, Reiki, Astrology, Human Design, Numerology, Ayurveda, Naturopathy, Family Constellation, and Systemic Constellation. No fluff. Just clarity.</description>
    <language>en</language>
    <copyright>© {now.year} Storm X Digital S.R.L.</copyright>
    <lastBuildDate>{rfc822(latest_build)}</lastBuildDate>
    <generator>Holistic Unity Blog RSS Generator</generator>
    <image>
      <url>{SITE_URL}/images/logo.png</url>
      <title>Holistic Unity Blog</title>
      <link>{SITE_URL}/blog/</link>
    </image>
{items_xml}
  </channel>
</rss>
"""


def main():
    posts = collect_posts()
    if not posts:
        print("No posts found — feed not generated.")
        return 1
    feed_xml = build_feed(posts)
    FEED_PATH.write_text(feed_xml, encoding="utf-8")
    print(f"Generated {FEED_PATH} with {len(posts)} posts:")
    for p in posts:
        print(f"  - {p['pub_date'].strftime('%Y-%m-%d')}  {p['title']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
