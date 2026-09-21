# georglynx.com audit

Audited 18 September 2026 against commit `d3fc7a7`. Updated 21 September 2026
after commit `0758785` (calc archived, Mahbles build step, clean-up) was deployed
and checked on the live site. Line numbers refer to the current tree, except
the calc section, which refers to the `calc-archive` tag.

This is the live list of known issues. Remove items as they are fixed, add new
ones as they are found.

## Fix first

1. **Confirm Netlify Identity registration is invite-only** (Netlify dashboard, Identity, Registration). Not verifiable from the repo. With git-gateway, any confirmed Identity user can commit to `main`.
2. **Disable GitHub Pages** in the GitHub repo settings. `georglynx.github.io` still answers with a 301, so Pages is enabled for a site that Netlify serves. `CNAME` is already deleted.

## Mahbles

3. **Game names, player names and notes go into `innerHTML` unescaped** (`script.js:485` `renderGameCard`, `script.js:553` `generateGameResults`, `script.js:510` `renderConflictBanner`). Low risk while only trusted CMS users write data. Fix: add an `esc()` helper and wrap every interpolated field.
4. **Random fallback colour can be a 5-digit hex** (`script.js:150`). Fix: `.toString(16).padStart(6, '0')`. Only triggers once the ten spare colours are used up.
5. **`<ul>` inside `<p class="rules-content">`** is invalid HTML, so the browser closes the `<p>` early and the padding on `.rules-content` never applies (`mahbles.html:46`). Fix: change the `<p>` to a `<div>`.
6. **Multi-line notes collapse to one line** (`style.css:492` `.game-notes`). Fix: add `white-space: pre-line`.
7. **Leftover purple tint** on `.game-notes` (`style.css:495`, `rgba(187, 134, 252, 0.1)`). Site accent is `#ffa500`. Fix: use `rgba(255, 165, 0, 0.08)` or drop the background.
8. **Decap CMS is range-pinned, not version-pinned** (`admin/index.html:13`, `decap-cms@^3.0.0`). A 3.x minor could change behaviour with no commit on your side. Fix: pin an exact version and bump deliberately.

## Housekeeping

9. **No security headers** in `netlify.toml`. Fix: add a `[[headers]]` block with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Robots-Tag: noindex` for `/admin/*` (the meta tag in `admin/index.html` covers HTML only).
10. **Homepage requests a `navigation.js` that does not exist** (`index.html:39`), a 404 on every visit. Deliberately deferred: pages are private for now. Fix when a nav is wanted, or remove the tag.
11. **Dead Anthropic key in local `.env`.** The account is banned. Delete the file or the key. Gitignored, so no leak risk.
12. **`node_modules/` left on disk** with only `cheerio` in it. Gitignored and no longer used. Delete it.

## Calc (only relevant if restored from `calc-archive`)

The calc is no longer deployed. Kept so a restore starts from a known list. Item 13 must be done before any restored calc goes live.

13. **`/api/search` has no rate limit or origin check** (`netlify/functions/search.js`, whole file; nothing reads `Origin` or `Referer`). Every uncached query costs an Anthropic call and several Trolley fetches. Fix: add a per-IP limit, reject requests not from the site, and set a spend cap on the new API key.
14. **Store filter is broken** (`calc/static/app.js:62` `onStoreFilterChange`) calls `currentIsHomeBrand` and `renderOtherOptions`, neither of which exists, so ticking a box after a search throws. Fix: call `renderCompareTable()`.
15. **CHEAPEST badge can be wrong** (`netlify/functions/search.js:280`, merge keeps lowest pack price per store; `search.js:326` alternatives carry `per100g: null`). Fix: normalise everything to per-100g server-side and compare on that.
16. **Timeout budget exceeds Netlify's 10 s default** (`search.js:603` 10 s per listing fetch, up to four in sequence, then Haiku, then 8 s detail fetches at `search.js:267`). Fix: 4 s per request and a total budget with early bail.
17. **Wasted Trolley requests on multi-word queries** (`search.js:111` and `:233` try three `/explore/` slugs before `/search/`). Fix: go straight to `/search/` for two or more words.
18. **Weight parsed from anywhere in the page** (`search.js:388`) can pick up another product. Fix: scope to the `h1` first.
19. **DOM-based store parse is dead code** (`search.js:398` builds `storeEntries`, which nothing reads; the text-splitting fallback always runs). Fix: finish it or delete it.
20. **Anthropic failures are swallowed** (`search.js:54` logs the message but not `res.status`). Fix: log status and body on non-2xx.
21. **Both store boxes unticked shows every store** (`app.js:121`). Fix: treat an empty selection as "none" or block the search.
22. **`switchMode` will throw if the mode toggle is restored before the basket section is uncommented** (`app.js:47`). Fix: null-guard the basket element.
23. **Dead CSS** for the abandoned clarification and brand-chip designs (`calc/static/style.css`: `.clarification*`, `.brand-chip*`, `.other-options`, `.oo-*`). Fix: delete.
