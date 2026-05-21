# Holistic Unity — Marketing Website

Static site for https://holisticunity.app. HTML + CSS + inline JS. No framework, no build.

## Quick Start

```bash
# Open locally (any static server)
python3 -m http.server 8000
# → http://localhost:8000

# Deploy to production
vercel --prod --yes
```

## Structure

See [CLAUDE.md](./CLAUDE.md) for the full project context — architecture, conventions, brand tokens, blog authoring rules, deployment, and known issues.

## Key Files

- `CLAUDE.md` — read this first. Project context for AI assistants (and humans).
- `shared.css` — global styles.
- `index.html` — homepage.
- `<modality>.html` — one page per therapy (9 modalities).
- `blog/index.html` — blog listing.
- `blog/<slug>.html` — individual post. See `blog/_drafts/` for markdown sources.
- `images/blog/_generate_pro.py` — FAL AI image generator for new posts.

## Languages

EN / IT / PT via inline `data-en` / `data-it` / `data-pt` attributes. Toggle persists to `localStorage.hu_lang`.

## Deployment

Vercel (project `prj_WDGMP74Ib3SxEfONAgKCWuaAbnj3`). Run `vercel --prod --yes` from this folder.
