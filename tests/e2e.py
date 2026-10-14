"""Headless Chromium end-to-end check for BreatheEasy (Playwright).

Run:   pip install playwright
       CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e.py      (or: python3 -m playwright install chromium)
       LIVE=1 ... also loads the real Open-Meteo APIs once (needs internet; the API has a daily rate limit).

By default Open-Meteo calls are answered from tests/fixtures (a real response saved on 2026-10-10)
and the app's clock is pinned with ?today=, so results are deterministic.
"""
import json, os, re, pathlib, sys, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / 'index.html').as_uri()
FIX = ROOT / 'tests' / 'fixtures'
AQ = (FIX / 'airquality-sugarland-2026-10-10.json').read_text()
WX = (FIX / 'weather-sugarland-2026-10-10.json').read_text()
GEO = (FIX / 'geocode-london-2026-10-11.json').read_text()   # real Open-Meteo Geocoding answer for "London"
GEO_LONG = (FIX / 'geocode-long-names-synthetic.json').read_text()   # SYNTHETIC: very long name + 3 same-looking Springfields
SHOTS = ROOT / 'tests' / 'screenshots'
SHOTS.mkdir(exist_ok=True)
passed = failed = 0


def check(name, cond, info=''):
    global passed, failed
    if cond:
        passed += 1; print('  ok   ' + name)
    else:
        failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))


HELD_GEO = []


def wire(page, mode='ok'):
    calls = []
    def handle(route):
        url = route.request.url
        calls.append(url)
        if mode == 'fail':
            return route.fulfill(status=429, content_type='application/json', body=json.dumps({'error': True, 'reason': 'Daily API request limit exceeded'}))
        if 'geocoding-api' in url:
            if 'name=Zzqx' in url:
                return route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"generationtime_ms":0.2}')
            if 'name=Slow' in url:
                HELD_GEO.append(route); return   # never answer: city search must give up after 8 s
            if 'name=Springfield' in url:
                return route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=GEO_LONG)
            if 'name=Fail' in url:
                return route.fulfill(status=503, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"error":true}')
            return route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=GEO)
        body = AQ if 'air-quality-api' in url else WX
        route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=body)
    page.route('**/*open-meteo.com/**', handle)
    return calls


kw = {'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}
with sync_playwright() as p:
    browser = p.chromium.launch(**kw)

    # ---------- desktop, pinned to 2026-10-09 so "tomorrow" is the real USG ozone day ----------
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True, locale='en-US')
    pg = ctx.new_page()
    errors, external = [], []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('request', lambda r: external.append(r.url) if r.url.startswith('http') and 'open-meteo.com' not in r.url else None)
    calls = wire(pg)
    print('Desktop flow')
    pg.goto(APP + '?today=2026-10-09')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('title', 'BreatheEasy' in pg.title())
    check('requested both Open-Meteo APIs', any('air-quality-api' in c for c in calls) and any('api.open-meteo.com/v1/forecast' in c for c in calls), calls)
    check('tomorrow AQI 140 (ozone 0.0826 -> 0.082 ppm truncated, EPA method)', pg.inner_text('#pc-aqi .aqi-num') == '140', pg.inner_text('#pc-aqi .aqi-num'))
    check('category: Unhealthy for sensitive groups', pg.inner_text('#pc-cat') == 'Unhealthy for sensitive groups', pg.inner_text('#pc-cat'))
    check('1280px: all tabs fit, no edge fade', not pg.evaluate("document.querySelector('.tabs-row').classList.contains('more')"))
    check('card color = EPA orange', pg.get_attribute('#plan-card', 'data-cat') == 'usg')
    items = pg.inner_text('#pc-items')
    check('EPA asthma line shown', 'follow their asthma action plan' in items, items)
    check('morning-ozone tip shown', 'lowest in the morning' in items)
    check('no medication text before the user adds a plan', 'puff' not in items.lower())
    check('pollen fact says no forecast for this area', 'No pollen forecast' in pg.inner_text('#pc-facts'))
    check("Devpost claim 'the app shows both' (EPA-method 140 and Open-Meteo's own peak hourly 143)", 'peak hourly US AQI: 143' in pg.inner_text('#fc-source') and pg.inner_text('#pc-aqi .aqi-num') == '140', pg.inner_text('#fc-source'))
    check('ozone shown as the truncated 82 ppb the AQI was computed from (not a rounded 83)', 'AQI 140 (82 ppb, 8 h)' in pg.inner_text('#pc-facts') and '83 ppb' not in pg.inner_text('#pc-facts'), pg.inner_text('#pc-facts'))
    check('4-day strip', pg.locator('#strip li').count() == 4, pg.locator('#strip li').count())
    check('source line cites Open-Meteo + EPA', 'Open-Meteo' in pg.inner_text('#fc-source') and 'EPA' in pg.inner_text('#fc-source'))
    check('personal outlook locked until 14 days', '14 days' in pg.inner_text('#pc-risk'))
    pg.screenshot(path=str(SHOTS / 'desktop-air.png'), full_page=False)

    # plan
    pg.fill('#p-best', '400')
    check('thresholds from personal best', 'Green: 320+' in pg.inner_text('#p-thr') and 'under 200' in pg.inner_text('#p-thr'), pg.inner_text('#p-thr'))
    pg.fill('#p-green', 'Controller inhaler: 2 puffs morning and night')
    pg.fill('#p-ex', '2 puffs of my rescue inhaler 15 minutes before practice')
    pg.fill('#p-yellow', 'Rescue inhaler 2-4 puffs, can repeat every 20 min up to 3 times. Call Dr. if not better in 1 hour.')
    pg.fill('#p-red', 'Rescue inhaler 4 puffs now, then call the doctor.')
    pg.fill('#p-phone', '(281) 555-0100')
    pg.check('input[name="trig"][value="ozone"]')
    pg.click('#plan-form button[type=submit]')
    check('plan saved message', 'saved' in pg.inner_text('#plan-msg').lower())
    items = pg.inner_text('#pc-items')
    check("user's own pre-exercise text appears on a USG day", '15 minutes before practice' in items, items)
    check('ozone-trigger line appears', 'marked ozone' in items)

    # check-in: yellow by peak flow
    pg.fill('#ci-pf', '300')
    pg.check('input[name="sym"][value="cough"]')
    pg.click('#ci-form button[type=submit]')
    res = pg.inner_text('#ci-result')
    check('300/400 = 75% -> yellow zone', 'Yellow zone' in res and '75%' in res, res)
    check("shows the user's yellow-zone text", 'repeat every 20 min' in res)
    check('result is a live region', pg.get_attribute('#ci-result', 'aria-live') == 'polite')

    # check-in: danger sign
    pg.fill('#ci-pf', '380')
    pg.uncheck('input[name="sym"][value="cough"]')
    pg.check('input[name="sym"][value="blue_lips"]')
    pg.click('#ci-form button[type=submit]')
    res = pg.inner_text('#ci-result')
    check('danger sign overrides good peak flow -> red', 'Red zone' in res, res)
    check('911 alert with tel: link', pg.locator('#ci-result .danger-alert a[href="tel:911"]').count() == 1)
    h911 = pg.locator('#ci-result .danger-alert a[href="tel:911"]').bounding_box()['height']
    check('Call 911 link is a 44px+ touch target', h911 >= 44, h911)
    check('NHLBI 15-minute red-zone wording', '15 minutes' in res)
    check("doctor's phone button", pg.locator('#ci-result a[href="tel:2815550100"]').count() == 1)
    pg.uncheck('input[name="sym"][value="blue_lips"]')
    check('history shows one entry (same date overwritten)', pg.locator('#history li.h-item').count() == 1)

    # logged pollen carries into tomorrow's card, labelled as a logged count (no US pollen forecast)
    pg.select_option('#ci-pollen', '3')
    pg.click('#ci-form button[type=submit]')
    check("tomorrow's pollen shows today's logged count, labelled", "High (today\u2019s logged count)" in pg.inner_text('#pc-facts'), pg.inner_text('#pc-facts'))
    check('still one entry after re-saving today', pg.locator('#history li.h-item').count() == 1)

    # insights with synthetic demo
    pg.click('#demo-toggle')
    pg.wait_for_selector('#weights:not([hidden])')
    check('demo banner says SYNTHETIC', 'SYNTHETIC' in pg.inner_text('#demo-banner'))
    check('model trained on 75 days', 'Trained on 75 days' in pg.inner_text('#model-status'), pg.inner_text('#model-status'))
    check('6 weight bars + accessible table', pg.locator('#weights-chart .wrow').count() == 6 and pg.locator('#weights-table tbody tr').count() == 6)
    top2 = [pg.inner_text(f'#weights-table tbody tr:nth-child({i}) th') for i in (1, 2)]
    check('top learned links are pollen + ozone (the planted pattern)', set(top2) == {'Pollen level', 'Ozone AQI'}, top2)
    check('held-out accuracy vs baseline reported', 'always guessing' in pg.inner_text('#eval'), pg.inner_text('#eval'))
    check('"why" explanation for tomorrow', pg.locator('#why-list li').count() >= 3)
    check('personal outlook now shows a band', pg.locator('#pc-risk .risk').count() == 1)
    check('held-out line now reports a Brier score', 'Brier score' in pg.inner_text('#eval'), pg.inner_text('#eval'))

    # explain a past day
    check('explain card shown once the model is ready', pg.is_visible('#explain'))
    check('explain picker lists all 75 logged days', pg.locator('#explain-date option').count() == 75, pg.locator('#explain-date option').count())
    check('explain view: start + 6 feature rows + result', pg.locator('#explain-out .ex-row').count() == 8, pg.locator('#explain-out .ex-row').count())
    check('explain view labels the synthetic day', 'SYNTHETIC' in pg.inner_text('#explain-out .ex-head'))
    pg.select_option('#explain-date', '2026-10-01')
    ex = pg.inner_text('#explain-out')
    check('explain Oct 1: odds multipliers + honest "before" prediction', '×' in ex and 'odds' in ex and 'Trained only on the' in ex, ex[:400])
    check('explain note says weighed, not caused', 'not what caused the day' in ex)
    first_btn = pg.locator('#history .btn-mini').first
    want = first_btn.get_attribute('data-date')
    check('each history row has an Explain button with a full label', pg.locator('#history .btn-mini').count() == 14 and 'Explain' in (first_btn.get_attribute('aria-label') or ''))
    hmini = pg.evaluate("() => Math.min(...[...document.querySelectorAll('#history .btn-mini')].map(b => b.getBoundingClientRect().height))")
    check('Explain buttons are 44px+ touch targets', hmini >= 44, hmini)
    first_btn.click()
    check('Explain button switches the picker to that day', pg.input_value('#explain-date') == want, (pg.input_value('#explain-date'), want))
    pg.select_option('#explain-date', pg.locator('#explain-date option').last.get_attribute('value'))
    check('earliest day: says there was no earlier model', 'not enough earlier days' in pg.inner_text('#explain-out'))
    pg.locator('#explain').screenshot(path=str(SHOTS / 'explain-day.png'))

    # SYNTHETIC calibration + sensitivity check
    pg.wait_for_function("document.querySelectorAll('#sens-table tbody tr').length > 0")
    check('trust card tagged SYNTHETIC', 'SYNTHETIC' in pg.inner_text('#trust .synth-tag'))
    check('reliability plot: diagonal + dots + 5-bin table', pg.locator('#rel-chart svg .diag').count() == 1 and pg.locator('#rel-chart svg circle').count() >= 3 and pg.locator('#rel-table tbody tr').count() == 5)
    check('sensitivity: 6 sizes (14..90 days) with lines for model/baseline/best', pg.locator('#sens-table tbody tr').count() == 6 and pg.locator('#sens-chart svg polyline').count() == 3)
    sens_first = pg.inner_text('#sens-table tbody tr:first-child th')
    check('sensitivity starts at 14 logged days', sens_first.startswith('14'), sens_first)
    tb = pg.inner_text('#trust-brier')
    check('Brier vs base-rate vs best possible + calibration error stated', 'Brier' in tb and 'best possible' in tb and 'Calibration error' in tb, tb)
    check('trust card states real-world limits', 'Real people are messier' in pg.inner_text('#trust'))
    pg.locator('#trust').screenshot(path=str(SHOTS / 'trust-check.png'))
    pg.screenshot(path=str(SHOTS / 'desktop-insights.png'), full_page=False)
    pg.locator('#insights').screenshot(path=str(SHOTS / 'insights-section.png'))

    # calendar export
    with pg.expect_download() as dl:
        pg.click('#ics')
    ics = pathlib.Path(dl.value.path()).read_text()
    check('.ics has tomorrow as all-day event', 'DTSTART;VALUE=DATE:20261010' in ics and 'AQI 140' in ics, ics[:300])
    check('calendar export confirms with a visible message', 'Calendar file downloaded' in pg.inner_text('#ics-msg'), pg.inner_text('#ics-msg'))
    pg.select_option('#lang', 'es'); pg.wait_for_timeout(200)
    srcs = pg.evaluate("[...document.querySelectorAll('ul.sources')].filter(u=>!u.hidden).length")
    check('Spanish: only the Spanish Sources list shows, and the calendar message is cleared', srcs == 1 and pg.inner_text('#ics-msg') == '' and 'Plan de acci' in pg.evaluate("[...document.querySelectorAll('ul.sources')].find(u=>!u.hidden).innerText"))
    pg.select_option('#lang', 'en'); pg.wait_for_timeout(200)

    # share note for a coach / school nurse
    pg.click('#share')
    pg.wait_for_selector('#share-box:not([hidden])')
    note = pg.input_value('#share-text')
    check('share note: date, place, AQI 140 + category', 'Saturday, October 10' in note and 'Sugar Land' in note and 'AQI 140, Unhealthy for sensitive groups' in note, note[:200])
    check("share note carries the user's own pre-exercise text", '15 minutes before practice' in note, note)
    check('share note ends with not-medical-advice + 911 line', 'Not medical advice' in note and 'Call 911' in note)
    # the message is set when the clipboard promise settles, so wait for it instead of reading it at once (race seen in CI Oct 12)
    try: pg.wait_for_function("() => document.querySelector('#share-msg').textContent.trim() !== ''", timeout=5000)
    except Exception: pass
    share_msg = pg.inner_text('#share-msg')
    check('share gives feedback (copied or select-to-copy)', share_msg.strip() != '', share_msg)

    # Spanish
    pg.select_option('#lang', 'es')
    check('html lang=es', pg.get_attribute('html', 'lang') == 'es')
    check('Spanish category', pg.inner_text('#pc-cat') == 'Insalubre para grupos sensibles', pg.inner_text('#pc-cat'))
    check('Spanish model check + explain view', pg.inner_text('#trust h3') == '¿Cuánto puedes confiar en el modelo?' and 'SINTÉTICA' in pg.inner_text('#trust .synth-tag') and 'Explicar' in pg.inner_text('#explain h3'))
    exh = pg.inner_text('#explain-out .ex-head')
    check('ES: synthetic day labelled SINTÉTICO, history says demostración (no English tag)', 'SINTÉTICO' in exh and 'SYNTHETIC' not in exh and 'demostración' in pg.inner_text('#history') and not re.search(r'· demo\b', pg.inner_text('#history')), (exh, pg.inner_text('#history')[:120]))
    es_note = pg.input_value('#share-text')
    check('open share note switches to Spanish (CDC/AirNow terms)', 'Insalubre para grupos sensibles' in es_note and 'Nota de BreatheEasy' in es_note and 'alivio rápido' in es_note, es_note[:200])
    check('Spanish about block visible, English hidden', pg.is_visible('[data-only="es"]') and not pg.is_visible('[data-only="en"]'))
    ab = pg.inner_text('.card.prose[data-only="es"]')
    check('ES about: lists the model inputs and the good+rough-days rule, like EN', 'Datos de entrada' in ab and 'si el día anterior fue difícil' in ab and 'algunos días buenos y algunos difíciles' in ab and 'Ozone Action Days' in ab, ab[:200])
    pg.screenshot(path=str(SHOTS / 'desktop-es.png'), full_page=False)
    pg.select_option('#lang', 'en')

    # persistence
    pg.reload()
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('plan persists after reload', pg.input_value('#p-best') == '400')
    check('demo persists and stays labelled', not pg.is_hidden('#demo-banner'))
    pg.click('#demo-toggle')
    check('removing demo returns to real log (1 entry)', pg.locator('#history li.h-item').count() == 1 and pg.is_hidden('#demo-banner'))

    # basic a11y checks
    unlabeled = pg.evaluate("""() => [...document.querySelectorAll('input,select,textarea')].filter(el => {
        if (el.type === 'hidden') return false;
        const id = el.id; const lab = id && document.querySelector('label[for="' + id + '"]');
        return !(lab || el.closest('label') || el.getAttribute('aria-label'));
      }).map(el => el.outerHTML.slice(0, 80))""")
    check('every form control has a label', not unlabeled, unlabeled)
    nameless = pg.evaluate("() => [...document.querySelectorAll('button,a')].filter(b => !(b.textContent.trim() || b.getAttribute('aria-label'))).length")
    check('every button/link has an accessible name', nameless == 0, nameless)
    check('one h1 + an h2 per section', pg.locator('h1').count() == 1 and pg.locator('main section > h2, main section .section-head > h2').count() == 5)
    check('skip link targets main', pg.get_attribute('.skip', 'href') == '#main')

    # wipe
    pg.once('dialog', lambda d: d.accept())
    pg.click('#wipe')
    check('wipe clears plan and history', pg.input_value('#p-best') == '' and 'No check-ins' in pg.inner_text('#history'))

    check('no JS errors', not errors, errors)
    check('no network calls except Open-Meteo', not external, external)
    ctx.close()

    # ---------- mobile 390px, pinned to 2026-10-10 ----------
    print('Mobile 390px flow')
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); m_err = []
    pg.on('pageerror', lambda e: m_err.append(str(e)))
    wire(pg)
    pg.goto(APP + '?today=2026-10-10&demo=1')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('tomorrow (Oct 11) AQI 64 Moderate', pg.inner_text('#pc-aqi .aqi-num') == '64' and pg.inner_text('#pc-cat') == 'Moderate', pg.inner_text('#pc-aqi .aqi-num'))
    check('?demo=1 loads labelled synthetic data', 'SYNTHETIC' in pg.inner_text('#demo-banner'))
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check('no horizontal overflow at 390px', sw <= 390, sw)
    small = pg.evaluate("""() => [...document.querySelectorAll('button, .btn, select, .tabs a')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.textContent.trim() || e.id)""")
    check('touch targets >= 44px tall', not small, small)
    pg.screenshot(path=str(SHOTS / 'mobile-air.png'), full_page=False)
    pg.screenshot(path=str(SHOTS / 'mobile-full.png'), full_page=True)
    pg.locator('#checkin').screenshot(path=str(SHOTS / 'mobile-checkin.png'))
    pg.locator('#insights').screenshot(path=str(SHOTS / 'mobile-insights.png'))
    check('no JS errors on mobile', not m_err, m_err)
    ctx.close()

    # ---------- first visit: one-tap demo of the AI + any-city search (390px) ----------
    print('One-tap demo + any-city search')
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); s_err = []
    pg.on('pageerror', lambda e: s_err.append(str(e)))
    pg.on('console', lambda m: s_err.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)  # the simulated 503 logs one
    scalls = wire(pg)
    pg.goto(APP + '?today=2026-10-10')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('first visit: outlook locked, demo button offered on the Air card', '14 days' in pg.inner_text('#pc-risk') and pg.is_visible('#try-demo') and 'SYNTHETIC' in pg.inner_text('#try-demo'))
    pg.click('#try-demo')
    check('one tap: personal outlook shows a band + SYNTHETIC tag', pg.locator('#pc-risk .risk').count() == 1 and 'SYNTHETIC' in pg.inner_text('#pc-risk .demo-tag'), pg.inner_text('#pc-risk'))
    check('demo button hides; Insights banner says SYNTHETIC', pg.is_hidden('#try-demo') and 'SYNTHETIC' in pg.inner_text('#demo-banner'))
    pg.click('#demo-toggle')
    check('removing demo brings the button back', pg.is_visible('#try-demo') and pg.locator('#pc-risk .risk').count() == 0)
    pg.fill('#place-q', 'London'); pg.click('#place-form button[type=submit]')
    pg.wait_for_function("document.querySelectorAll('#place-results button').length > 0")
    names = pg.locator('#place-results button').all_inner_texts()
    check('city search: 5 choices, biggest first', len(names) == 5 and names[0] == 'London, England, United Kingdom' and names[1] == 'London, Ontario, Canada', names)
    check('city search used Open-Meteo Geocoding in English', any('geocoding-api.open-meteo.com' in c and 'name=London' in c and 'language=en' in c for c in scalls))
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check('no horizontal overflow with search results at 390px', sw <= 390, sw)
    small = pg.evaluate("""() => [...document.querySelectorAll('#place-form button, #place-q')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.textContent.trim() || e.id)""")
    check('search controls >= 44px tall', not small, small)
    pg.locator('#today').screenshot(path=str(SHOTS / 'place-search.png'))
    n_before = len(scalls)
    pg.click('#place-results button >> nth=0')
    pg.wait_for_function("document.querySelector('#fc-status').textContent === ''")
    new = scalls[n_before:]
    check('picking London fetches its forecast (lat 51.5085)', any('air-quality-api' in c and 'latitude=51.5085' in c for c in new) and any('/v1/forecast' in c and 'latitude=51.5085' in c for c in new), new)
    check('location menu now shows the chosen city', pg.eval_on_selector('#loc', 'e => e.options[e.selectedIndex].text') == 'London, England, United Kingdom' and 'London' in pg.inner_text('#place-msg'))
    n_before = len(scalls)
    pg.reload()
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('chosen city persists after reload', pg.input_value('#loc') == 'search' and pg.eval_on_selector('#loc', 'e => e.options[e.selectedIndex].text') == 'London, England, United Kingdom')
    check('reload within 30 min reuses that city\'s saved forecast (no new API call) and says so', not any('air-quality-api' in c for c in scalls[n_before:]) and 'saved on this device (as of' in pg.inner_text('#fc-status'), (scalls[n_before:], pg.inner_text('#fc-status')))
    pg.fill('#place-q', 'Zzqx'); pg.press('#place-q', 'Enter')
    pg.wait_for_function("document.querySelector('#place-msg').textContent.includes('No place')")
    check('no match: plain message, no buttons', pg.locator('#place-results li').count() == 0)
    pg.fill('#place-q', 'Fail'); pg.press('#place-q', 'Enter')
    pg.wait_for_function("document.querySelector('#place-msg').textContent.includes('not available')")
    check('search outage: says so and keeps the current city', 'London, England' in pg.inner_text('#place-msg') and pg.input_value('#loc') == 'search', pg.inner_text('#place-msg'))
    pg.select_option('#lang', 'es')
    check('Spanish search labels + demo button', pg.inner_text('#place-q-label') == 'O busca cualquier ciudad' and 'SINTÉTICOS' in pg.inner_text('#try-demo'))
    pm = pg.inner_text('#place-msg')
    check('ES: city-search outage message re-worded in Spanish, no English or raw HTTP text', 'no está disponible' in pm and 'error 503' in pm and not any(w in pm for w in ('not available', 'City search', 'HTTP', 'We kept')), pm)
    check('ES: search placeholder and button in Spanish', pg.get_attribute('#place-q', 'placeholder') == 'p. ej., Phoenix, Delhi, Londres' and pg.inner_text('#place-form button[type=submit]') == 'Buscar')
    pg.fill('#place-q', 'Zzqx'); pg.press('#place-q', 'Enter')
    pg.wait_for_function("document.querySelector('#place-msg').textContent.includes('No encontramos')")
    check('ES: no-match message in Spanish', 'No encontramos' in pg.inner_text('#place-msg') and 'No place' not in pg.inner_text('#place-msg'), pg.inner_text('#place-msg'))
    pg.fill('#place-q', 'Slow'); pg.press('#place-q', 'Enter')
    pg.wait_for_function("document.querySelector('#place-msg').textContent.includes('8 segundos')", timeout=20000)
    pm = pg.inner_text('#place-msg')
    check('ES: city-search 8 s timeout worded in Spanish (no "City search")', 'no respondió en 8 segundos' in pm and 'City search' not in pm and 'didn' not in pm, pm)
    for r in HELD_GEO:
        try: r.abort()
        except Exception: pass
    HELD_GEO.clear()
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check('ES: no horizontal overflow at 390px (search messages + SYNTHETIC button)', sw <= 390, sw)
    # strict-judge round 2: very long names wrap inside the 390 px column, same-looking places are told apart
    pg.fill('#place-q', 'Springfield'); pg.press('#place-q', 'Enter')
    pg.wait_for_function("document.querySelectorAll('#place-results button').length === 5")
    names = pg.locator('#place-results button').all_inner_texts()
    check('long-name results: 5 distinct labels (county added to same-looking Springfields)', len(set(names)) == 5 and 'Springfield, Greene, Missouri, United States' in names and 'Springfield, Webster, Missouri, United States' in names, names)
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check('long-name results: no horizontal overflow at 390px', sw <= 390, sw)
    poke = pg.evaluate("() => [...document.querySelectorAll('#place-results li, #place-results button')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length")
    check('long-name results: every choice fits inside the screen', poke == 0, poke)
    tall = pg.evaluate("() => [...document.querySelectorAll('#place-results button')].map(b => Math.round(b.getBoundingClientRect().height))")
    check('long-name results: the 58-letter name wraps onto more lines inside its button (all >= 44 px tall)', tall[[n.startswith('Llanfair') for n in names].index(True)] > min(tall) and min(tall) >= 44, tall)
    check('results list is named by the "pick your city" line', pg.evaluate("() => document.querySelector('#place-results').getAttribute('aria-labelledby')") == 'place-msg')
    pg.locator('#place-form').screenshot(path=str(SHOTS / 'place-search-long-es.png'))
    pg.locator('#place-results button', has_text='Llanfair').click()
    pg.wait_for_function("document.querySelector('#loc').value === 'search' && document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    sw = pg.evaluate('document.documentElement.scrollWidth')
    check('ES 390px: after picking the 58-letter city, the Location menu does not widen the page', sw <= 390, sw)
    # strict-judge round 2: Spanish tabs overflow the 390 px row -> faded right edge until scrolled to the end
    check('ES 390px: tabs row is marked "more to the right" (edge fade)', pg.evaluate("document.querySelector('.tabs-row').classList.contains('more')"))
    pg.evaluate("(()=>{const r=document.querySelector('.tabs-row'); r.scrollLeft = r.scrollWidth; r.dispatchEvent(new Event('scroll'));})()")
    pg.wait_for_timeout(100)
    check('ES 390px: fade goes away once the last tab is in view', not pg.evaluate("document.querySelector('.tabs-row').classList.contains('more')"))
    pg.evaluate("(()=>{const r=document.querySelector('.tabs-row'); r.scrollLeft = 0; r.dispatchEvent(new Event('scroll'));})()")
    fw = pg.evaluate("(()=>{const dl=document.querySelector('#pc-facts'), dd=dl.querySelector('dd'); return dd ? dd.getBoundingClientRect().width / dl.getBoundingClientRect().width : 0;})()")
    check('ES 390px: forecast values get most of the card width (label column capped)', fw >= 0.55, fw)
    pg.locator('#today').screenshot(path=str(SHOTS / 'place-search-es.png'))
    pg.select_option('#loc', 'sugarland')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('switching back to a preset city works (its own saved forecast, labelled in Spanish)', any('latitude=29.6197' in c for c in scalls) and 'guardado en este dispositivo (de hace' in pg.inner_text('#fc-status'), pg.inner_text('#fc-status'))
    pg.click('#refresh')
    pg.wait_for_function("document.querySelector('#fc-status').textContent === ''")
    check('Refresh skips the saved copy and asks Open-Meteo again', any('air-quality-api' in c and 'latitude=29.6197' in c for c in scalls[-2:]), scalls[-2:])
    check('no JS errors in search/demo flow', not s_err, s_err)
    ctx.close()

    # ---------- installable + offline (served over http so the service worker can run) ----------
    print('PWA: install + offline')
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = socketserver.TCPServer(('127.0.0.1', 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{port}/'
    ctx = browser.new_context(viewport={'width': 390, 'height': 844})
    net = {'offline': False}
    def ctx_route(route):
        if net['offline']:
            return route.abort('internetdisconnected')
        body = AQ if 'air-quality-api' in route.request.url else WX
        route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=body)
    ctx.route('**/*open-meteo.com/**', ctx_route)
    pg = ctx.new_page(); p_err = []
    pg.on('pageerror', lambda e: p_err.append(str(e)))
    pg.goto(base + '?today=2026-10-10')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    man = pg.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
    check('manifest served and parsed', man.get('display') == 'standalone' and len(man.get('icons', [])) >= 3, man)
    pg.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)", timeout=15000)
    pg.reload(); pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=15000)
    check('service worker controls the page', pg.evaluate('!!navigator.serviceWorker.controller'))
    caches = pg.evaluate('caches.keys()')
    ver = pg.evaluate("document.querySelector('link[rel=stylesheet]').href.split('?v=')[1]")
    check('one cache, named with the current content hash', caches == ['breatheeasy-' + ver], (caches, ver))
    cached = pg.evaluate("caches.open(" + json.dumps('breatheeasy-' + ver) + ").then(c => c.keys()).then(k => k.map(r => r.url))")
    check('app shell precached with ?v= URLs; no forecast API cached', any('js/app.js?v=' + ver in u for u in cached) and not any('open-meteo' in u for u in cached), len(cached))
    ctx.set_offline(True); net['offline'] = True
    pg.reload()
    pg.wait_for_function("document.querySelector('#fc-status').textContent.length > 0", timeout=15000)
    check('offline reload: app still loads from the cache', 'BreatheEasy' in pg.title() and pg.inner_text('#pc-aqi .aqi-num') == '64', pg.inner_text('#pc-aqi .aqi-num'))
    check('offline note names the saved forecast', 'offline' in pg.inner_text('#fc-status').lower(), pg.inner_text('#fc-status'))
    pg.screenshot(path=str(SHOTS / 'offline-mobile.png'), full_page=False)
    ctx.set_offline(False)
    check('no JS errors in the PWA flow', not p_err, p_err)
    ctx.close(); httpd.shutdown()

    # ---------- API failure ----------
    print('API failure')
    ctx = browser.new_context(); pg = ctx.new_page(); f_err = []
    pg.on('pageerror', lambda e: f_err.append(str(e)))
    wire(pg, 'fail')
    pg.goto(APP + '?today=2026-10-10')
    pg.wait_for_function("document.querySelector('#fc-status').textContent.includes('limit')")
    check('rate-limit reason shown to the user (in our own EN/ES wording)', 'too many requests (rate limit reached)' in pg.inner_text('#fc-status'), pg.inner_text('#fc-status'))
    check('no data at all: clear message, no AQI number', 'No air-quality data for Sugar Land, TX' in pg.inner_text('#fc-status') and pg.inner_text('#pc-aqi .aqi-num') == '—', pg.inner_text('#fc-status'))
    check('no crash on API failure', not f_err, f_err)
    ctx.close()

    # ---------- 429 after a good answer: per-place fallback with an honest age ----------
    print('429 fallback')
    ctx = browser.new_context(locale='en-US'); pg = ctx.new_page(); r_err = []
    pg.on('pageerror', lambda e: r_err.append(str(e)))
    mode = {'v': 'ok'}
    def r_handle(route):
        if mode['v'] == '429':
            return route.fulfill(status=429, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'error': True, 'reason': 'Minutely API request limit exceeded'}))
        body = AQ if 'air-quality-api' in route.request.url else WX
        route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=body)
    pg.route('**/*open-meteo.com/**', r_handle)
    pg.goto(APP + '?today=2026-10-10')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    age = "(m) => { const k = 'breatheeasy.fccache.v1'; const c = JSON.parse(localStorage.getItem(k)); Object.values(c).forEach(e => e.savedAt -= m * 60000); localStorage.setItem(k, JSON.stringify(c)); }"
    pg.evaluate(age, 45); mode['v'] = '429'
    pg.reload()
    pg.wait_for_function("document.querySelector('#fc-status').textContent.includes('Open-Meteo')")
    st = pg.inner_text('#fc-status')
    check('429 with a 45-min-old answer: forecast still shown', pg.inner_text('#pc-aqi .aqi-num') == '64', pg.inner_text('#pc-aqi .aqi-num'))
    check('429 status names the rate limit and says "as of 45 min ago"', 'too many requests' in st and 'as of 45 min ago' in st, st)
    check('source line carries the same age', 'as of 45 min ago' in pg.inner_text('#fc-source'), pg.inner_text('#fc-source'))
    pg.select_option('#lang', 'es')
    st = pg.inner_text('#fc-status')
    check('Spanish fallback label: "de hace 45 min"', 'demasiadas solicitudes' in st and 'de hace 45 min' in st, st)
    check('ES 429 status carries no English (API reason not pasted in)', not any(w in st for w in ('limit exceeded', 'Minutely', 'too many', 'as of')), st)
    pg.locator('#today').screenshot(path=str(SHOTS / 'rate-limit-fallback.png'))
    pg.select_option('#lang', 'en')
    pg.evaluate(age, 150)  # now 3 h 15 min old: past the fallback limit
    pg.reload()
    pg.wait_for_function("document.querySelector('#fc-status').textContent.includes('No air-quality data')")
    check('after 3 h the old answer is dropped: no AQI, clear no-data message', pg.inner_text('#pc-aqi .aqi-num') == '—' and 'last 3 hours' in pg.inner_text('#fc-status'), pg.inner_text('#fc-status'))
    check('no JS errors in the 429 flow', not r_err, r_err)
    ctx.close()

    # ---------- slow / offline network: 8 s timeout, last result kept, EN/ES message ----------
    print('Slow / offline network')
    import time
    ctx = browser.new_context(locale='en-US'); pg = ctx.new_page(); n_err = []
    pg.on('pageerror', lambda e: n_err.append(str(e)))
    nmode = {'v': 'ok'}; held = []
    def n_handle(route):
        if nmode['v'] == 'hang':
            held.append(route); return   # never answer: the app must give up on its own
        if nmode['v'] == 'down':
            return route.abort('internetdisconnected')
        body = AQ if 'air-quality-api' in route.request.url else WX
        route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=body)
    pg.route('**/*open-meteo.com/**', n_handle)
    pg.goto(APP + '?today=2026-10-10')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    pg.evaluate(age, 40); nmode['v'] = 'hang'
    t0 = time.time(); pg.reload()
    pg.wait_for_function("document.querySelector('#fc-status').textContent.includes('8 seconds')", timeout=20000)
    took = time.time() - t0; st = pg.inner_text('#fc-status')
    check('hung Open-Meteo: app gives up after ~8 s (not sooner, not never)', 7.0 <= took <= 15.0, round(took, 1))
    check('hung Open-Meteo requests were really made (and held)', any('air-quality-api' in r.request.url for r in held), len(held))
    check('timeout: last result stays on screen (AQI 64)', pg.inner_text('#pc-aqi .aqi-num') == '64', pg.inner_text('#pc-aqi .aqi-num'))
    check('timeout message is clear and honest about age (EN)', 'didn\u2019t answer within 8 seconds' in st and 'as of 40 min ago' in st and 'Refresh' in st, st)
    check('timeout message styled as a warning', 'status-warn' in (pg.get_attribute('#fc-status', 'class') or ''))
    pg.select_option('#lang', 'es'); st = pg.inner_text('#fc-status')
    check('timeout message in Spanish', 'no respondi\u00f3 en 8 segundos' in st and 'de hace 40 min' in st and 'didn' not in st and 'Refresh' not in st, st)
    pg.locator('#today').screenshot(path=str(SHOTS / 'timeout-fallback-es.png'))
    pg.select_option('#lang', 'en')
    pg.evaluate("localStorage.removeItem('breatheeasy.fccache.v1')")
    pg.reload()
    pg.wait_for_function("document.querySelector('#fc-status').textContent.includes('No air-quality data')", timeout=20000)
    st = pg.inner_text('#fc-status')
    check('timeout with nothing saved: no AQI, no-data message names the timeout', pg.inner_text('#pc-aqi .aqi-num') == '—' and '8 seconds' in st, st)
    for r in held:
        try: r.abort()
        except Exception: pass
    held.clear()
    nmode['v'] = 'ok'; pg.click('#refresh')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('back online: Refresh brings the forecast back', pg.inner_text('#pc-aqi .aqi-num') == '64')
    pg.evaluate(age, 40)
    ctx.set_offline(True); nmode['v'] = 'down'
    t0 = time.time(); pg.click('#refresh')
    pg.wait_for_function("document.querySelector('#fc-status').textContent.includes('offline')", timeout=10000)
    took = time.time() - t0; st = pg.inner_text('#fc-status')
    check('offline Refresh: answers at once (no 8 s wait)', took < 4, round(took, 1))
    check('offline: last result kept (AQI 64) with an offline note and its age', pg.inner_text('#pc-aqi .aqi-num') == '64' and 'You\u2019re offline' in st and 'as of 40 min ago' in st, st)
    pg.select_option('#lang', 'es'); st = pg.inner_text('#fc-status')
    check('offline note in Spanish', 'sin conexi\u00f3n' in st and 'de hace 40 min' in st and 'offline' not in st, st)
    pg.select_option('#lang', 'en')
    ctx.set_offline(False)
    check('no JS errors in the slow/offline flow', not n_err, n_err)
    ctx.close()

    # ---------- Back up / Restore + storage.persist() (post-judging branch, drafted by Hark) ----------
    print('Back up / Restore')
    import tempfile
    tmp = pathlib.Path(tempfile.mkdtemp())
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True, locale='en-US')
    ctx.add_init_script("window.__persistCalls = 0; if (navigator.storage) navigator.storage.persist = () => { window.__persistCalls++; return Promise.resolve(false); };")
    pg = ctx.new_page(); b_err = []
    pg.on('pageerror', lambda e: b_err.append(str(e)))
    pg.on('console', lambda m: b_err.append(m.text) if m.type == 'error' else None)
    wire(pg)
    pg.goto(APP + '?today=2026-10-09')
    pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    check('storage.persist() not asked on page load', pg.evaluate('window.__persistCalls') == 0, pg.evaluate('window.__persistCalls'))
    pg.click('a[href="#plan"]'); pg.fill('#p-best', '400'); pg.fill('#p-green', 'Controller every day'); pg.click('#plan-form button[type=submit]')
    pg.wait_for_function("document.querySelector('#plan-msg').textContent.length > 0")
    check('storage.persist() asked on the first save', pg.evaluate('window.__persistCalls') == 1, pg.evaluate('window.__persistCalls'))
    pg.click('#plan-form button[type=submit]'); pg.select_option('#lang', 'es'); pg.select_option('#lang', 'en')
    pg.reload(); pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—'")
    pg.click('a[href="#plan"]'); pg.click('#plan-form button[type=submit]')
    check('storage.persist() asked only once per browser profile', pg.evaluate('window.__persistCalls') == 0 and pg.evaluate("localStorage.getItem('breatheeasy.persist-asked.v1')") == '1')
    check('Restore button is 44px+ and the file input is hidden', pg.locator('#restore').bounding_box()['height'] >= 44 and not pg.locator('#restore-file').is_visible())
    backup = {'exportedAt': '2026-10-09T12:00:00Z', 'plan': {'personalBest': 420, 'green': 'Flovent 2 puffs', 'yellow': 'Albuterol', 'red': 'ER', 'beforeExercise': '', 'doctorPhone': '555-0100', 'triggers': ['ozone', 'pollen']},
              'entries': [{'date': '2026-10-0%d' % d, 'zone': z, 'peakFlow': pf, 'personalBest': 420, 'percent': round(pf / 420 * 100), 'symptoms': []} for d, z, pf in [(5, 'green', 400), (6, 'yellow', 300), (7, 'green', 390)]]}
    good = tmp / 'breatheeasy-data.json'; good.write_text(json.dumps(backup))
    pg.once('dialog', lambda d: (b_err.append('unexpected dialog: ' + d.message) if 'Replace' not in d.message else None, d.accept()))
    pg.set_input_files('#restore-file', str(good))
    pg.wait_for_function("document.querySelector('#data-msg').textContent.includes('restored')")
    check('restore replaces the plan', pg.input_value('#p-best') == '420' and pg.input_value('#p-green') == 'Flovent 2 puffs', pg.input_value('#p-best'))
    check('restore brings back the check-ins', pg.locator('#history .h-item').count() == 3 and '3 check-ins' in pg.inner_text('#data-msg'), pg.inner_text('#data-msg'))
    pg.select_option('#lang', 'es')
    check('restore message follows a language switch', 'Copia restaurada' in pg.inner_text('#data-msg'), pg.inner_text('#data-msg'))
    pg.select_option('#lang', 'en')
    with pg.expect_download() as dl:
        pg.click('#export')
    out = json.loads(pathlib.Path(dl.value.path()).read_text())
    check('round trip: export after restore gives the same plan and check-ins', out['plan'] == backup['plan'] and out['entries'] == backup['entries'], out)
    bad = tmp / 'bad.json'; bad.write_text('{"plan": oops')
    pg.set_input_files('#restore-file', str(bad))
    pg.wait_for_function("document.querySelector('#data-msg').textContent.includes('Nothing was changed')")
    check('malformed file refused, data unchanged', "isn't a BreatheEasy backup" in pg.inner_text('#data-msg') and pg.input_value('#p-best') == '420' and pg.locator('#history .h-item').count() == 3)
    big = tmp / 'big.json'; big.write_text(json.dumps({'plan': {}, 'entries': [], 'pad': 'x' * (1024 * 1024 + 10)}))
    pg.set_input_files('#restore-file', str(big))
    pg.wait_for_function("document.querySelector('#data-msg').textContent.includes('too big')")
    check('oversized file refused, data unchanged', pg.input_value('#p-best') == '420' and pg.locator('#history .h-item').count() == 3)
    pg.once('dialog', lambda d: d.dismiss())
    other = tmp / 'other.json'; other.write_text(json.dumps({'plan': {'personalBest': 300}, 'entries': []}))
    pg.set_input_files('#restore-file', str(other))
    pg.wait_for_timeout(300)
    check('cancelling the replace prompt keeps the current data', pg.input_value('#p-best') == '420' and pg.locator('#history .h-item').count() == 3)
    check('no JS errors in Back up / Restore', not b_err, b_err)
    ctx.close()

    # ---------- optional live API ----------
    if os.environ.get('LIVE') == '1':
        print('Live Open-Meteo')
        ctx = browser.new_context(); pg = ctx.new_page()
        pg.goto(APP)
        try:
            pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '—' || document.querySelector('#fc-status').textContent.length > 20", timeout=20000)
            txt = pg.inner_text('#pc-aqi .aqi-num')
            check('live forecast renders a numeric AQI', txt.isdigit(), pg.inner_text('#fc-status'))
        except Exception as e:
            check('live forecast renders', False, e)
        ctx.close()

    browser.close()

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
