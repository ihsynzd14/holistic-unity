import glob
from bs4 import BeautifulSoup
print(f"{'page':40} {'data-en==data-it (untranslated EN)':>10}  /total")
for f in sorted(glob.glob('_src/*.html')+glob.glob('_src/blog/*.html')):
    s=BeautifulSoup(open(f,encoding='utf-8').read(),'html.parser')
    els=s.select('[data-en]')
    same=[e for e in els if (e.get('data-en') or '').strip() and (e.get('data-en') or '').strip()==(e.get('data-it') or '').strip()]
    if same:
        print(f"{f.split('_src/')[1]:40} {len(same):>10}  /{len(els)}")
