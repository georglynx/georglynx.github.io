# georglynx.com audit

Audited 18 September 2026 against commit `d3fc7a7` plus the staged, uncommitted
working-tree changes from the same day (calc archive tag, Mahbles build step,
stylesheet and config clean-up). Line numbers refer to the working tree.

This is the live list of known issues. Remove items as they are fixed, add new
ones as they are found.

## Fix first

1. **Calc removal is half done.** The calc, its Netlify function, `CNAME`, `deno.lock`, `reviews.html`, `gamedev.html` and four unused images are still in the tree. Run `git rm -rq calc netlify package.json package-lock.json deno.lock CNAME reviews.html gamedev.html images/old images/georglynx.png images/shush.png`, then commit and push once Netlify credits reset. Until pushed, the live `/api/search` stays open and scrapes Trolley on every uncached query.
2. **`/api/search` has no rate limit or origin check** (`netlify/functions/search.js`, whole file; nothing reads `Origin` or `Referer`). Resolved by item 1. If the calc is ever restored, add a per-IP limit and reject requests not from the site before deploying.
3. **Confirm Netlify Identity registration is invite-only** (Netlify dashboard, Identity, Registration). Not verifiable from the repo. With git-gateway, any confirmed Identity user can commit to `main`.
4. **Push the archive tag.** `git push origin calc-archive`. Tag pushes do not trigger a Netlify build. Until pushed the archive exists only on this machine.
5. **Disable GitHub Pages** in the repo settings. `georglynx.github.io` still answers with a 301, so Pages is enabled for a site that Netlify now serves. Deleting `CNAME` (item 1) is the other half.

## Mahbles

6. **Game names, player names and notes go into `innerHTML` unescaped** (`script.js:485` `renderGameCard`, `script.js:553` `generateGameResults`, `script.js:510` `renderConflictBanner`). Low risk while only trusted CMS users write data. Fix: add an `esc()` helper and wrap every interpolated field.
7. **Random fallback colour can be a 5-digit hex** (`script.js:150`). Fix: `.toString(16).padStart(6, '0')`. Only triggers once the ten spare colours are used up.
8. **`<ul>` inside `<p class="rules-content">`** is invalid HTML, so the browser closes the `<p>` early and the padding on `.rules-content` never applies (`mahbles.html:46`). Fix: change the `<p>` to a `<div>`.
9. **Multi-line notes collapse to one line** (`style.css:492` `.game-notes`). Fix: add `white-space: pre-line`.
10. **Leftover purple tint** on `.game-notes` (`style.css:495`, `rgba(187, 134, 252, 0.1)`). Site accent is `#ffa500`. Fix: use `rgba(255, 165, 0, 0.08)` or drop the background.
11. **Decap CMS is range-pinned, not version-pinned** (`admin/index.html:13`, `decap-cms@^3.0.0`). A 3.x minor could change behaviour with no commit on your side. Fix: pin an exact version and bump deliberately.

## Housekeeping

12. **No security headers** in `netlify.toml`. Fix: add a `[[headers]]` block with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Robots-Tag: noindex` for `/admin/*` (the meta tag in `admin/index.html` covers HTML only).
13. **Homepage requests a `navigation.js` that does not exist** (`index.html:39`), a 404 on every visit. Deliberately deferred: pages are private for now. Fix when a nav is wanted, or remove the tag.
14. **Dead Anthropic key in local `.env`.** The account is banned. Delete the file or the key. Gitignored, so no leak risk.
15. **`node_modules/` left on disk** with only `cheerio` in it. Gitignored. Delete once the calc is gone.
16. **Repo name and `CNAME` are GitHub Pages leftovers.** The repo name cannot change without a redirect, so leave it; `CLAUDE.md` now says the site is on Netlify.

## Calc (only relevant if restored from `calc-archive`)

These are confirmed in the working tree but become moot once item 1 is pushed. Kept so a restore starts from a known list.

17. **Store filter is broken** (`calc/static/app.js:62` `onStoreFilterChange`) calls `currentIsHomeBrand` and `renderOtherOptions`, neither of which exists, so ticking a box after a search throws. Fix: call `renderCompareTable()`.
18. **CHEAPEST badge can be wrong** (`netlify/functions/search.js:280`, merge keeps lowest pack price per store; `search.js:326` alternatives carry `per100g: null`). Fix: normalise everything to per-100g server-side and compare on that.
19. **Timeout budget exceeds Netlify's 10 s default** (`search.js:603` 10 s per listing fetch, up to four in sequence, then Haiku, then 8 s detail fetches at `search.js:267`). Fix: 4 s per request and a total budget with early bail.
20. **Wasted Trolley requests on multi-word queries** (`search.js:111` and `:233` try three `/explore/` slugs before `/search/`). Fix: go straight to `/search/` for two or more words.
21. **Weight parsed from anywhere in the page** (`search.js:388`) can pick up another product. Fix: scope to the `h1` first.
22. **DOM-based store parse is dead code** (`search.js:398` builds `storeEntries`, which nothing reads; the text-splitting fallback always runs). Fix: finish it or delete it.
23. **Anthropic failures are swallowed** (`search.js:54` logs the message but not `res.status`). Fix: log status and body on non-2xx.
24. **Both store boxes unticked shows every store** (`app.js:121`). Fix: treat an empty selection as "none" or block the search.
25. **`switchMode` will throw if the mode toggle is restored before the basket section is uncommented** (`app.js:47`). Fix: null-guard the basket element.
26. **Dead CSS** for the abandoned clarification and brand-chip designs (`calc/static/style.css`: `.clarification*`, `.brand-chip*`, `.other-options`, `.oo-*`). Fix: delete.
