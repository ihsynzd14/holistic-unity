#!/usr/bin/env python3
"""
add_a11y.py — accessibility (EAA / WCAG) fixes.

  #4 contrast: muted text #8a6a80 (fails 4.5:1 on cream) -> #71536a (passes).
  #2 bypass blocks (WCAG 2.4.1): add a "skip to content" link as the first
     <body> child, and ensure a <main id="main"> landmark exists as its target
     (add id to an existing <main>, else wrap the nav→footer content in <main>).

Runs on _src templates (multilingual skip-link, baked by the prerender) AND on
the standalone legal pages (plain Italian skip-link). Idempotent.
"""
import os
import re
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_src")

OLD_MUTED, NEW_MUTED = "#8a6a80", "#71536a"

SKIP_SRC = ('<a class="skip-link" href="#main" data-en="Skip to main content" '
            'data-it="Vai al contenuto principale" data-pt="Pular para o conteúdo principal">'
            'Vai al contenuto principale</a>')
SKIP_LEGAL = '<a class="skip-link" href="#main">Vai al contenuto principale</a>'

BODY_RE = re.compile(r'(<body\b[^>]*>)', re.IGNORECASE)
MAIN_OPEN_RE = re.compile(r'<main\b([^>]*)>', re.IGNORECASE)
NAVCLOSE_RE = re.compile(r'</nav>', re.IGNORECASE)
FOOTER_RE = re.compile(r'<footer\b', re.IGNORECASE)


def ensure_main_id(text):
    """Add id='main' tabindex='-1' to the first <main>, or wrap content if none."""
    m = MAIN_OPEN_RE.search(text)
    if m:
        attrs = m.group(1)
        new = attrs
        if not re.search(r'\bid=', new):
            new += ' id="main"'
        if not re.search(r'\btabindex=', new):
            new += ' tabindex="-1"'
        if new != attrs:
            text = text[:m.start()] + f"<main{new}>" + text[m.end():]
        return text
    # no <main> -> wrap nav→footer content
    nav = NAVCLOSE_RE.search(text)
    foot = FOOTER_RE.search(text)
    if not nav or not foot or foot.start() < nav.end():
        return text  # unexpected structure; leave as-is
    foot_line = text.rfind("\n", 0, foot.start()) + 1
    indent = re.match(r"[ \t]*", text[foot_line:foot.start()]).group(0)
    text = (text[:nav.end()] + '\n  <main id="main" tabindex="-1">' +
            text[nav.end():foot.start()] + f"</main>\n{indent}" + text[foot.start():])
    return text


def process(path, legal):
    text = open(path, encoding="utf-8").read()
    changed = False
    if OLD_MUTED in text:
        text = text.replace(OLD_MUTED, NEW_MUTED); changed = True
    if "skip-link" not in text or 'href="#main"' not in text:
        skip = SKIP_LEGAL if legal else SKIP_SRC
        if BODY_RE.search(text):
            text = BODY_RE.sub(lambda m: f"{m.group(1)}\n  {skip}", text, count=1)
            text = ensure_main_id(text)
            changed = True
    if changed:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
    return changed


def main():
    src = glob.glob(os.path.join(SRC, "*.html")) + glob.glob(os.path.join(SRC, "blog", "*.html"))
    legal = [os.path.join(ROOT, x) for x in
             ("privacy-policy.html", "terms-clients.html", "terms-therapists.html", "cookie-policy.html")]
    n = 0
    for f in src:
        if process(f, legal=False):
            n += 1
    for f in legal:
        if os.path.exists(f) and process(f, legal=True):
            n += 1
    print(f"a11y (contrast + skip-link/main) applied to {n} files")


if __name__ == "__main__":
    main()
