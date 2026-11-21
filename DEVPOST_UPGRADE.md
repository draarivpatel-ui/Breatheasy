# BreatheEasy: prior base vs Nov 15, 2026 enhancements

This file is the change log for the Nov 15, 2026 upgrade pass. It separates what was already in the submitted base from what this pass added, and it records the test counts verified on this machine on Nov 15, 2026.

## Prior base (submitted Oct 2026)

- Static, on-device asthma action plan matched to tomorrow's ozone, PM2.5 and pollen forecast.
- EPA AQI math with the 2024 PM2.5 breakpoints, the 17-period 8-hour ozone rule and published worked examples.
- NHLBI green / yellow / red zones, a 20-second check-in, EPA guidance beside the user's own doctor-written plan, and a Call 911 line for danger signs.
- A small on-device logistic regression trained on the user's own check-ins, with per-feature explanations and an honest held-out score.
- A SYNTHETIC calibration check (reliability plot, Brier score, sensitivity to logged days) in the Insights tab, plus EN/ES copy, city search, per-place forecast cache with 429 / timeout fallback, calendar and share notes, print stylesheet, and an installable service worker.
- Verified test count in the base README: **126/126 unit tests** (Oct 13, 2026 CI run), plus 526 headless-browser checks.

## Nov 15, 2026 enhancements

### Engineering

- Added `js/benchmark.js`: a deterministic benchmark and validation suite with 76 checks. It pins 65 golden vectors against EPA AQI breakpoints, NHLBI zone cut-offs, calendar-date and saved-state guards, and forecast parsing; adds 11 held-out model checks with three reference baselines, explicit pass conditions, a 95 percent uncertainty band and pinned per-metric regression tolerances.
- Fixed engine edge cases: `category()` now refuses negative AQI instead of returning Good; zone helpers refuse blank strings, booleans, arrays and negative percentages; `assess()` tolerates a non-array symptoms field from a hand-edited saved row; `pollenLevel()` refuses non-object inputs; `maxOzone8h()` rejects a series with a clock gap instead of averaging non-consecutive hours; saved place labels and plan text are capped so a corrupt copy cannot widen a narrow viewport.
- Added `tests/benchmark.test.js`: 25 tests covering the pure engine (determinism, baseline comparisons, failure conditions, regression tolerances, shareable report), every new edge case, and the interactive DOM (run, detail toggle, copy, download, language switch, keyboard and ARIA, 375 px CSS contracts).

### UI / UX

- New **Verification** tab with a Run button, a pass/fail score, per-group results, an accessible model table with three reference baselines, a decorative bar chart where every number is also in a table, a Show every check disclosure, and a shareable plain-text report with Copy and Download (TXT) controls.
- EN/ES strings for all 32 new keys, with placeholder parity and no English leakage into Spanish.
- High-contrast PASS / FAIL colors with text labels (not color alone), focus moved to the result on Run, polite status announcements, `aria-expanded` / `aria-controls` on the disclosure, and a keyboard-focusable report region.
- Responsive CSS: buttons stack at 420 px, long labels wrap with `overflow-wrap: anywhere`, tables stay inside a 375 px viewport, and the print stylesheet keeps the report legible on Letter paper.
- Crisp export: the same deterministic report is shown on the page, copied to the clipboard and downloaded as a `.txt` file.

### Documentation

- `README.md` now documents the Verification suite, the baseline comparison, failure conditions and uncertainty bounds, and quotes the verified Nov 15 count.
- This file records the prior base and the Nov 15 additions with verified counts.

## Verified test counts (Nov 15, 2026)

| Suite | Command | Result |
|---|---|---|
| Unit + DOM | `node --test tests/*.test.js` (`npm test`) | **151 passed, 0 failed** |
| Benchmark / validation engine + UI | `node --test tests/benchmark.test.js` | **25 passed, 0 failed** (included in the 151) |
| Benchmark checks inside one report | `require('./js/benchmark.js').run()` | **76 passed, 0 failed** |

Prior base for comparison: 126 unit tests (Oct 13, 2026). Net change: +25 unit and DOM tests, +76 in-app benchmark checks.

## Scope and honesty

The benchmark uses published EPA thresholds and SYNTHETIC people with a known hidden pattern. It is an engineering regression and calibration check, not a clinical validation. Held-out days always come after the training window. No network calls, clock reads or user data are involved, so two runs on the same code produce identical numbers.
