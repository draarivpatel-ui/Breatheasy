# BreatheEasy review log

## Cycle 1 · Sat Oct 10, 2026, ~8:25 PM ET (improvement pass for "AI x Healthcare" judging)

Judge's-eye gap: the model already explained tomorrow and reported held-out accuracy on 19 demo days, but a
health-tech judge would ask "are its percentages trustworthy, how much data does it need, and can I see why it
said what it said about a specific day?" The app also needed a connection to open at all.

| Change | Detail |
|---|---|
| SYNTHETIC model check (`js/validate.js`) | 12 made-up people (seeds 101–112), 200 days each; the model trains on logged days and is scored only on the 100 later days. Reliability bins (5) with expected calibration error, mean predicted vs. observed rate, Brier vs. climatology (each person's usual rate) and vs. the best possible score (the generator's hidden probabilities, exposed only via `generate(..., withTruth)`), and a sensitivity sweep over 14/21/30/45/60/90 logged days. Deterministic, ~0.3 s, runs in the browser. |
| Results (SYNTHETIC) | At 60 logged days, 1,200 held-out days: ECE 3.8 pts (said 57% avg, 55% rough), Brier 0.172 vs. 0.252 climatology vs. 0.157 best possible; accuracy 75% vs. 52% guess-common vs. 77% best. Sensitivity: 62% / 70% / 72% / 73% / 75% / 75% accuracy and Brier 0.252 → 0.171 from 14 to 90 days; at 14 days 1 of 12 people had too few rough/good days so the model waited. Slight over-prediction in the 20–60% bins, stated in README. |
| "How much can you trust it?" card | Purple SYNTHETIC tag, SVG reliability plot (dots sized by count, dashed perfect-calibration line), SVG accuracy-vs-days chart (model / guess-common / best possible), a data table behind each chart, the Brier sentence, and a limits line ("real people are messier"). EN + ES. |
| Explain a past day | `M.explainDay()`: starting point (average day), each feature's log-odds push with its odds multiplier, result; plus what a model trained only on the earlier days would have said (null when too few). Picker over all logged days + an **Explain** button on each history row. Text says it shows what the model weighed, not what caused the day. |
| Brier on the per-log eval line | "Honest check … Brier score 0.12 (lower is better)" on the 75-day demo. |
| Installable + offline PWA | `manifest.webmanifest` (standalone, 192/512 + maskable icons, apple-touch-icon), `sw.js` (network-first pages, cache-first for `?v=`-versioned files, never caches Open-Meteo, deletes old caches, skipWaiting + clients.claim). Registers only over http(s). Offline: app opens from cache and says "You're offline. Showing the forecast saved {time}"; re-fetches on the `online` event. |
| Cache-busting | `scripts/stamp.js` hashes index.html (normalised), sw.js, manifest, icons and every JS/CSS file into `be-<10 hex>`, written to `sw.js` VERSION and every `?v=` in index.html. A unit test fails if the stamp is stale. Run `node scripts/stamp.js` after any change. |
| Docs | README (AI section with the SYNTHETIC numbers + table, features, tests, files, limits), devpost.md (what it does, how we built it, accomplishments, what's next), demo-script.md (new 2:15–2:35 beat, kept under 3:00, honesty line), in-app About (EN/ES). |

Honesty: no new health guidance was added; all medical text is still the cited NHLBI / EPA / CDC lines plus the
user's own plan. Every new model number is labelled SYNTHETIC in the app and docs.

Checks: `node --test tests/*.test.js` 44 → **57 passing** (new: validate.test.js ×7, pwa.test.js ×4, explainDay ×2).
`CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e.py` 58 → **82 passing** (explain view, trust card, Spanish
strings, and a served-over-http PWA flow: manifest, SW control, one hash-named cache with no forecast API in it,
offline reload rendering tomorrow's card with the offline note). Screenshots reviewed at 1280 and 390 px; fixed
a wrapping °F, a clipped "100%" tick, and wrapping bin labels.

Not done: `onepager.pdf` was not regenerated, so it doesn't mention the trust check, explain-a-day or offline mode.
GitHub Pages is still not enabled (see registry), so the PWA can't be installed from a live URL yet.
