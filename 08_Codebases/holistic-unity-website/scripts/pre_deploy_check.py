#!/usr/bin/env python3
"""pre_deploy_check.py — verify the DEPLOYABLE output is internally consistent."""
import os, re, glob, json
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# deployable HTML = root + en/ + pt/ + blog trees + legal (NOT _src, NOT preview/dashboard/backup)
def deployable():
    fs = (glob.glob("*.html") + glob.glob("en/**/*.html", recursive=True) +
          glob.glob("pt/**/*.html", recursive=True) + glob.glob("blog/*.html"))
    return [f for f in fs if not any(s in f for s in ("backup", "dashboard_1mag", "1e88c1c8", "_src", "preview"))]

def disk(htmlfile, ref):
    s = unquote(ref.split("?")[0].split("#")[0])
    if s.startswith("http") or s.startswith("//") or s.startswith("data:") or s.startswith("mailto:"):
        return None
    if s.startswith("/"):
        base, s = ROOT, s.lstrip("/")
    else:
        base = os.path.dirname(htmlfile)
    return os.path.normpath(os.path.join(base, s))

pages = deployable()
print(f"Deployable HTML pages: {len(pages)}\n")

# --- A. broken local asset references (the #1 deploy risk after PNG deletes / inlining) ---
broken = {}
ASSET_RE = re.compile(r'(?:src|href|srcset)\s*=\s*"([^"]+)"', re.I)
for f in pages:
    h = open(f, encoding="utf-8").read()
    h = re.sub(r"<!--.*?-->", "", h, flags=re.S)   # ignore commented-out markup (inert)
    refs = []
    for m in ASSET_RE.finditer(h):
        val = m.group(1)
        for part in val.split(","):                # srcset can be comma-list
            u = part.strip().split(" ")[0]
            if re.search(r"\.(png|jpe?g|webp|svg|gif|css|js|ico)$", u, re.I):
                refs.append(u)
    for u in refs:
        p = disk(f, u)
        if p and not os.path.exists(p):
            broken.setdefault(f, set()).add(u)
print(f"A. Broken local asset refs: {sum(len(v) for v in broken.values())} across {len(broken)} pages")
for f, us in list(broken.items())[:10]:
    print(f"   {f}: {sorted(us)[:4]}")

# --- B. SEO tag completeness ---
def has(h, p): return bool(re.search(p, h, re.I))
seo_missing = []
for f in pages:
    h = open(f, encoding="utf-8").read()
    m = [k for k, pat in (("title", r"<title>[^<]"), ("desc", r'name="description"'),
         ("canonical", r'rel="canonical"'), ("og:title", r'property="og:title"'),
         ("og:desc", r'property="og:description"')) if not has(h, pat)]
    if m: seo_missing.append((f, m))
print(f"\nB. Pages missing core SEO tags: {len(seo_missing)}")
for f, m in seo_missing[:10]: print(f"   {f}: {m}")

# --- C. JSON-LD validity ---
bad = tot = 0
for f in pages:
    for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', open(f, encoding="utf-8").read(), re.S):
        tot += 1
        try: json.loads(m)
        except Exception: bad += 1
print(f"\nC. JSON-LD blocks: {tot}, invalid: {bad}")

# --- D. perf wiring: no external shared.css (inlined); fonts async where present ---
ext_css = [f for f in pages if re.search(r'<link[^>]*rel="stylesheet"[^>]*shared\.css', open(f,encoding="utf-8").read(), re.I)]
font_block = [f for f in pages if "fonts.googleapis.com" in open(f,encoding="utf-8").read()]
font_async = [f for f in font_block if 'media="print"' in open(f,encoding="utf-8").read()]
print(f"\nD. external shared.css links (want 0): {len(ext_css)}")
print(f"   pages loading Google Fonts: {len(font_block)} | of those async: {len(font_async)}")

# --- E. a11y: skip-link + main + lang ---
no_skip = [f for f in pages if "skip-link" not in open(f,encoding="utf-8").read()]
no_main = [f for f in pages if not re.search(r'id="main"', open(f,encoding="utf-8").read())]
no_lang = [f for f in pages if not re.search(r'<html[^>]*\blang="[\w-]+"', open(f,encoding="utf-8").read())]
print(f"\nE. a11y — no skip-link: {len(no_skip)} | no #main: {len(no_main)} | no <html lang>: {len(no_lang)}")
for f in (no_skip+no_main)[:6]: print(f"   check: {f}")

# --- F. sitemap sanity: every <loc> path resolves to a file ---
sm = open("sitemap.xml", encoding="utf-8").read()
locs = re.findall(r"<loc>https://holisticunity\.app/(.*?)</loc>", sm)
missing_loc = []
for loc in locs:
    cand = loc.rstrip("/")
    f = (cand + ".html") if cand else "index.html"
    if cand.endswith("/") or cand == "":
        f = (cand + "index.html")
    if not os.path.exists(f) and not os.path.exists(cand + "/index.html"):
        missing_loc.append(loc)
print(f"\nF. sitemap <loc> entries: {len(locs)} | not resolving to a file: {len(missing_loc)}")
for l in missing_loc[:8]: print(f"   {l}")

print("\n=== VERDICT ===")
ok = (not broken) and (not seo_missing) and bad==0 and len(ext_css)==0 and not no_skip and not no_main and not missing_loc
print("READY TO DEPLOY" if ok else "ISSUES FOUND - see above")
