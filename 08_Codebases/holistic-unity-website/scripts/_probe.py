from bs4 import BeautifulSoup
for f in ['_src/ayurveda.html','_src/naturopathy.html']:
    s=BeautifulSoup(open(f,encoding='utf-8').read(),'html.parser')
    l=s.select_one(".tagline, .section-subtitle, .page-hero p, .hero-content p")
    print("##",f, "| class:",l.get('class') if l else None)
    for L in ('en','it','pt'):
        print(f"  data-{L}:", (l.get('data-'+L) or '(none)') if l else '?')
    print()
