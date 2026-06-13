# Competitor Backlink Targets — Holistic Unity

> **Tool status (2026-06-13):** the connected SEO tool is on the **free tier (3 reports/day)**,
> and today's quota is used up. Auto competitor-detection returned `noData` (normal — the
> domain is brand-new with no ranking footprint yet). So this list is curated from the niche;
> re-run the exact query below tomorrow for the precise, data-backed link gap.

## Re-run this tomorrow (gives the exact "go get these" domains)
The `backlink_opportunity` tool returns domains that link to competitors **but not to you** —
that's your shortlist. Suggested call:

```
backlink_opportunity(
  positive_targets = [
    { target: "unobravo.com",     scope: "domain" },
    { target: "serenis.it",       scope: "domain" },
    { target: "cure-naturali.it", scope: "domain" }
  ],
  negative_targets = [ { target: "holisticunity.app", scope: "domain" } ],
  limit = 25
)
```
Also useful: `linking_domains(domain="cure-naturali.it", filter_by="new", begin_date=…, end_date=…)`
to see who's linking to a topical competitor *recently* (fresh, replicable targets).

## Competitors worth analysing (and why)
| Domain | Why it's a useful comp |
|---|---|
| **cure-naturali.it** | Closest topical match — Italian holistic/natural-wellness portal. Its link sources are the most replicable for you. |
| **unobravo.com** | IT online-therapy marketplace — same "verified practitioners, online sessions, book online" model; huge, well-earned backlink profile to study. |
| **serenis.it** | Same as Unobravo (online therapy, IT) — newer, so its *recent* links show what a young IT wellness brand can realistically earn. |
| **riza.it** | IT holistic/psychosomatic publisher — strong media/editorial links in the wellness space. |
| *(intl)* mindbodygreen.com / classpass.com | Wellness-booking at scale — aspirational, mostly for ideas not direct replication. |

## Likely high-value target types (curated, while you wait for the data)
These are the *kinds* of sites that link to the competitors above and that you can realistically earn:

- **IT wellness magazines / portals** — riza.it, cure-naturali.it, greenme.it, ohga.it, and the *benessere* sections of mainstream titles (e.g. vanityfair.it, elle.com/it, donnamoderna.com). → pitch via outreach template A.
- **L.4/2013 professional associations** (SIAF, CSEN discipline olistiche, etc.) — affiliate/member listings. Highest topical trust + reinforces your "verified credentials" angle. → directory kit, Tier 4.
- **Startup / tech press** — startupitalia.eu, eu-startups.com, Crunchbase, Product Hunt, BetaList. → directory kit, Tier 2.
- **Podcasts / interview sites** in wellness & entrepreneurship — guest appearances usually include a show-notes link. → outreach template A/C.
- **Complementary local businesses** — yoga studios, wellness centres, naturopaths' own sites. → outreach template B (and the operator badge is the scalable version of this).

## Reality check on your current 1 backlink
The only link found (`xploredomains.com/...`) is an **auto-generated domain-listing page** and is
**nofollow** → it passes no authority and is not worth pursuing or disavowing. Treat your real
editorial backlink count as **0** today — everything above is how you go from 0 to a healthy profile.

## Priority order
1. **Operator badge** (`practitioner-badge.html`) — scales with the business, near-zero outreach.
2. **Directory/citation kit** Tier 1 + Tier 4 — fast, high-trust, topical.
3. **Re-run `backlink_opportunity` tomorrow** → work the resulting domain list with outreach template A.
4. Social profiles (Tier 5) — quick referring-domain wins.
