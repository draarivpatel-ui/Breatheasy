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

## Cycle 2 · Sat Oct 10, 2026, ~9:00 PM ET (one-pager + Spanish strict-judge pass)

| Change | Detail |
|---|---|
| `onepager.pdf` regenerated | One Letter page, 84.5 KB, render checked at 110 and 200 dpi. Adds a purple "How much can you trust it? (SYNTHETIC)" panel with vector reliability and accuracy-vs-days charts (ECE 3.8 pts, Brier 0.172 vs 0.252 vs 0.157 best, 75% vs 52% vs 77% best at 60 days), NEW bullets for Explain this day, Share with coach or nurse, and Installable + offline; test counts updated to 58 / 83; "offline installable app" removed from next steps; CDC Spanish plan added to sources. Source: `/workspace/work/be_scratch/onepager.html` (card image recompressed to 400 px, q48, to stay under 85 KB). |
| Spanish strict-judge pass (`js/i18n.js`) | Checked against the CDC *Plan de acción para el control del asma* (2024 PDF, cdc.gov/asthma/media/pdfs/2024/07/asthma-action-plan-es-508.pdf), CDC *Vivir con asma* (cdc.gov/asthma/es/living-with/vivir-con-asma.html), NHLBI *Síntomas*, *Ataque de asma* and *Tratamiento y plan de acción* (nhlbi.nih.gov/es/salud/asma/...), and AirNow español (espanol.airnow.gov). Fixes: "Silbido al respirar" → **"Sibilancias (silbido al respirar)"** (CDC plan, NHLBI); "falta de aire" → **"dificultad para respirar"** everywhere (CDC plan zones/danger signs, EPA Spanish ozone guide), incl. "Mucha dificultad para respirar" and the 911 line; "Señales de peligro" → **"Signos de peligro"** (CDC "SIGNOS DE PELIGRO"); "mejor marca" (sports word) → **"mejor puntuación"** (CDC "Su mejor puntuación"), plus a gender-agreement fix (usarlo → usarla); AQI categories "Dañina…" (1999 EPA wording) → **"Insalubre para grupos sensibles / Insalubre / Muy insalubre"** (current AirNow español); tense made consistent in the yellow/red activity items ("…mis actividades habituales", "No pude hacer ninguna de mis actividades habituales", CDC wording); "Vas bien" → "Te sientes bien" (CDC "Se siente bien"); "hablar con tu médico" → "comunicarte con tu médico" (CDC); "Zona verde: medicamentos de control diarios"; "Nada" → "Ninguno" (pollen level); "¿…confiar en él?" → "¿…confiar en el modelo?"; "×{x} probabilidades" → "probabilidades ×{x}"; share button names the school nurse. Plan intro now points Spanish speakers to the CDC's Spanish action plan. Kept: "opresión en el pecho" (NHLBI), "medicamento de alivio rápido" (CDC + NHLBI), "desencadenantes", informal tú throughout (the agencies use usted; tú fits a teen-facing app). |
| Bug found in review | Switching language left an open share note in the old language. It now re-writes itself on language change unless the user edited it (`refreshShareText` in `js/app.js`). |
| Tests | New unit test guards the CDC/AirNow terms and retired words; e2e checks the Spanish share note. `node --test` **58/58**, e2e **83/83**. Stamp `be-717dc65895`. |

Not done: GitHub Pages still not enabled.

## Cycle 3 · Sun Oct 11, 2026, ~11:15 AM ET (strict-judge review against the DSH Hacks V2 rubric)

Rubric (dsh-hacks-v2.devpost.com): Idea (theme fit, innovation, impact if deployed), Implementation (does it work, technical challenge), Design (UX, interface), Presentation (problem clearly defined and addressed).

Judge's-eye gaps, ranked:
1. **Impact / Implementation:** a global, online event with judges outside Texas, but the app only offered Sugar Land, Houston, Pasadena or browser geolocation (often denied in judging setups). A judge could not see *their own* city's tomorrow card.
2. **Presentation / Idea:** the AI is the headline, but a first visit shows "Log at least 14 days…" on the Air card; the demo button lived only in Insights, so a 2-minute judge may never see the model's outlook on tomorrow's card.
3. (Not fixable by Hark) GitHub Pages still off, so the README "Live demo" link 404s. Aariv must switch it on (AARIV-TODO).

| Shipped | Detail |
|---|---|
| Any-city search (`js/places.js`, Air tab) | "Or find any city" box → Open-Meteo Geocoding API (free, no key, CORS; verified 2026-10-11). Up to 5 choices, biggest place first, labelled "City, Region, Country"; one match is picked directly. The chosen city joins the Location menu and persists. Clear messages for no match and for a search outage (keeps the current city), 8 s timeout. EN + ES. Service worker precaches the new file; stamp `be-102b11e056`. |
| One-tap AI preview on the Air card | When the model isn't ready and no demo is loaded, the personal-outlook box shows **See it work on SYNTHETIC demo data**. One tap loads the same seeded 75-day synthetic set as Insights, the outlook shows its band + % with a purple **SYNTHETIC demo data** pill (replaces the old "(demo)" suffix), and focus moves to the result. Removing demo data in Insights brings the button back. |

Checks: `node --test tests/*.test.js` 58 → **63/63** (new `tests/places.test.js`: URL encoding/language, ranking on a real saved "London" answer, malformed input, labels, EN/ES strings). `CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e.py` 83 → **99/99** (new 390 px flow: demo button → band + SYNTHETIC tag → removable; London search → 5 choices → forecast fetched at lat 51.5085 → persists after reload; no-match and 503 messages; Spanish labels; back to a preset city; no overflow; 44 px targets; no JS errors). Screenshot `tests/screenshots/place-search.png` reviewed.

Not changed: Devpost draft (untouched), onepager.pdf (doesn't mention city search yet), gallery images.
