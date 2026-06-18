# -*- coding: utf-8 -*-
"""
One-shot: insert Quantum Touch Releasing® (QTR®) into the nav dropdown + footer
"Therapies" list across all _src templates, right after the SEED – Energy Process®
link. Also bumps the homepage (index.html) discipline counts 11 -> 12, the
therapy-card numbers ".. / 11" -> ".. / 12", and the stale mini-stat counter.

Idempotent: files that already mention quantum-touch-releasing are skipped, so the
freshly authored _src/quantum-touch-releasing.html is left untouched and re-runs
are safe. The new homepage card itself is added separately (precise Edit).

Run:  python scripts/add_qtr_navfooter.py
"""
import re, glob, os

SRC = os.path.join(os.path.dirname(__file__), "..", "_src")

# Matches the SEED nav/footer LINK in any variant:
#   root:  <a href="seed-energy-process" [data-*]>SEED – Energy Process®</a>
#   blog:  <a href="../seed-energy-process" [data-*]>SEED – Energy Process®</a>
#   index: <a href="seed-energy-process">SEED – Energy Process®</a>
# It will NOT match the homepage therapy-CARD anchor (that one is
# `...seed-energy-process" class="therapy-card ...">` followed by inner markup,
# not by ">SEED – Energy Process®</a>").
SEED_LINK = re.compile(
    r'<a href="((?:\.\./)?)seed-energy-process"([^>]*)>SEED – Energy Process®</a>'
)

def qtr_link(prefix, attrs):
    if "data-en" in attrs:
        data = ' data-en="Quantum Touch Releasing®" data-it="Quantum Touch Releasing®" data-pt="Quantum Touch Releasing®"'
    else:
        data = ''
    return f'<a href="{prefix}quantum-touch-releasing"{data}>Quantum Touch Releasing®</a>'

def process(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        s = f.read()
    if "quantum-touch-releasing" in s:
        return None  # already done / the QTR page itself
    n = len(SEED_LINK.findall(s))
    if n == 0:
        return 0
    s = SEED_LINK.sub(lambda m: m.group(0) + qtr_link(m.group(1), m.group(2)), s)

    extra = {}
    if os.path.basename(path) == "index.html":
        before = s
        s = s.replace("11 discipline", "12 discipline")   # IT + EN "disciplines" + "discipline olistiche"
        s = s.replace("11 disciplinas", "12 disciplinas")  # PT
        s = s.replace("/ 11</div>", "/ 12</div>")          # therapy-card numbers
        s = s.replace('<div class="v" data-count="10">10</div><div class="l" data-en="Verified disciplines"',
                      '<div class="v" data-count="12">12</div><div class="l" data-en="Verified disciplines"')
        extra["counts_changed"] = before != s

    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(s)
    return {"seed_links": n, **extra}

def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.html"))) + \
            sorted(glob.glob(os.path.join(SRC, "blog", "*.html")))
    changed = skipped = 0
    for p in files:
        r = process(p)
        rel = os.path.relpath(p, SRC)
        if r is None:
            skipped += 1
        elif r == 0:
            print(f"  (no SEED link)        {rel}")
        else:
            changed += 1
            tag = f"+{r['seed_links']} QTR link(s)"
            if r.get("counts_changed"):
                tag += "  +homepage counts 11->12"
            print(f"  edited {tag:34} {rel}")
    print(f"\nDONE: {changed} edited, {skipped} skipped (already had QTR).")

if __name__ == "__main__":
    main()
