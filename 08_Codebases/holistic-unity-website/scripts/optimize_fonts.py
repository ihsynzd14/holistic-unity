#!/usr/bin/env python3
"""
optimize_fonts.py — make Google Fonts non-render-blocking (Fix 1), run on _src.

The homepage (+3 pages) loaded Google Fonts via a render-blocking
`<link rel="stylesheet">` to fonts.googleapis.com — on 3G that cross-origin CSS
request sits on the critical path and delays First Contentful Paint. This:
  - trims the requested set to the weights the CSS actually uses
    (Cormorant 500/600/700 + italic 500/600; drops unused 400-roman & 400-italic),
  - loads the font CSS asynchronously (preload + media=print/onload swap +
    <noscript> fallback) so it no longer blocks the first paint. `display=swap`
    (already present) means text renders instantly in the system fallback.

Idempotent. Run on _src BEFORE prerender.
"""
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_src")

TRIMMED = ("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:"
           "ital,wght@0,500;0,600;0,700;1,500;1,600&family=Inter:wght@400;500;600;700"
           "&display=swap")

# the existing render-blocking stylesheet link (href before or after rel)
FONT_LINK_RE = re.compile(
    r'<link\b[^>]*fonts\.googleapis\.com/css2[^>]*\brel="stylesheet"[^>]*>'
    r'|<link\b[^>]*\brel="stylesheet"[^>]*fonts\.googleapis\.com/css2[^>]*>',
    re.IGNORECASE)


def async_block(indent):
    return (
        f'<link rel="preload" as="style" href="{TRIMMED}">\n'
        f'{indent}<link rel="stylesheet" href="{TRIMMED}" media="print" onload="this.media=\'all\'">\n'
        f'{indent}<noscript><link rel="stylesheet" href="{TRIMMED}"></noscript>'
    )


def main():
    files = glob.glob(os.path.join(SRC, "*.html")) + glob.glob(os.path.join(SRC, "blog", "*.html"))
    changed = 0
    for f in files:
        text = open(f, encoding="utf-8").read()
        if 'media="print"' in text and "fonts.googleapis.com" in text:
            continue  # already async (idempotent)
        m = FONT_LINK_RE.search(text)
        if not m:
            continue
        line_start = text.rfind("\n", 0, m.start()) + 1
        indent = re.match(r"[ \t]*", text[line_start:m.start()]).group(0)
        text = text[:m.start()] + async_block(indent) + text[m.end():]
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        changed += 1
        print(f"  {os.path.relpath(f, ROOT)}: fonts -> async + trimmed")
    print(f"\nfont loading optimized on {changed} pages")


if __name__ == "__main__":
    main()
