"""Headless Chromium end-to-end check for BreatheEasy (Playwright).

Run:   pip install playwright
       CHROMIUM_PATH=/usr/bin/chromium python3 tests/e2e.py      (or: python3 -m playwright install chromium)
       LIVE=1 ... also loads the real Open-Meteo APIs once (needs internet; the API has a daily rate limit).

By default Open-Meteo calls are answered from tests/fixtures (a real response saved on 2026-10-10)
and the app's clock is pinned with ?today=, so results are deterministic.
"""
import json, os, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / 'index.html').as_uri()
FIX = ROOT / 'tests' / 'fixtures'
AQ = (FIX / 'airquality-sugarland-2026-10-10.json').read_text()
WX = (FIX / 'weather-sugarland-2026-10-10.json').read_text()
SHOTS = ROOT / 'tests' / 'screenshots'
SHOTS.mkdir(exist_ok=True)
passed = failed = 0


def check(name, cond, info=''):
    global passed, failed
    if cond:
        passed += 1; print('  ok   ' + name)
    else:
        failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))


def wire(page, mode='ok'):
    calls = []
    def handle(route):
        url = route.request.url
        calls.append(url)
        if mode == 'fail':
            return route.fulfill(status=429, content_type='application/json', body=json.dumps({'error': True, 'reason': 'Daily API request limit exceeded'}))
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
    check('tomorrow AQI 140 (ozone 0.083 ppm, EPA method)', pg.inner_text('#pc-aqi .aqi-num') == '140', pg.inner_text('#pc-aqi .aqi-num'))
    check('category: Unhealthy for sensitive groups', pg.inner_text('#pc-cat') == 'Unhealthy for sensitive groups', pg.inner_text('#pc-cat'))
    check('card color = EPA orange', pg.get_attribute('#plan-card', 'data-cat') == 'usg')
    items = pg.inner_text('#pc-items')
    check('EPA asthma line shown', 'follow their asthma action plan' in items, items)
    check('morning-ozone tip shown', 'lowest in the morning' in items)
    check('no medication text before the user adds a plan', 'puff' not in items.lower())
    check('pollen fact says no forecast for this area', 'No pollen forecast' in pg.inner_text('#pc-facts'))
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
    pg.screenshot(path=str(SHOTS / 'desktop-insights.png'), full_page=False)
    pg.locator('#insights').screenshot(path=str(SHOTS / 'insights-section.png'))

    # calendar export
    with pg.expect_download() as dl:
        pg.click('#ics')
    ics = pathlib.Path(dl.value.path()).read_text()
    check('.ics has tomorrow as all-day event', 'DTSTART;VALUE=DATE:20261010' in ics and 'AQI 140' in ics, ics[:300])

    # share note for a coach / school nurse
    pg.click('#share')
    pg.wait_for_selector('#share-box:not([hidden])')
    note = pg.input_value('#share-text')
    check('share note: date, place, AQI 140 + category', 'Saturday, October 10' in note and 'Sugar Land' in note and 'AQI 140, Unhealthy for sensitive groups' in note, note[:200])
    check("share note carries the user's own pre-exercise text", '15 minutes before practice' in note, note)
    check('share note ends with not-medical-advice + 911 line', 'Not medical advice' in note and 'Call 911' in note)
    check('share gives feedback (copied or select-to-copy)', pg.inner_text('#share-msg').strip() != '', pg.inner_text('#share-msg'))

    # Spanish
    pg.select_option('#lang', 'es')
    check('html lang=es', pg.get_attribute('html', 'lang') == 'es')
    check('Spanish category', pg.inner_text('#pc-cat') == 'Dañina para grupos sensibles', pg.inner_text('#pc-cat'))
    check('Spanish about block visible, English hidden', pg.is_visible('[data-only="es"]') and not pg.is_visible('[data-only="en"]'))
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
    small = pg.evaluate("""() => [...document.querySelectorAll('button, .btn, select, .tabs a')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).map(e => e.textContent.trim() || e.id)""")
    check('touch targets >= 40px tall', not small, small)
    pg.screenshot(path=str(SHOTS / 'mobile-air.png'), full_page=False)
    pg.screenshot(path=str(SHOTS / 'mobile-full.png'), full_page=True)
    pg.locator('#checkin').screenshot(path=str(SHOTS / 'mobile-checkin.png'))
    pg.locator('#insights').screenshot(path=str(SHOTS / 'mobile-insights.png'))
    check('no JS errors on mobile', not m_err, m_err)
    ctx.close()

    # ---------- API failure ----------
    print('API failure')
    ctx = browser.new_context(); pg = ctx.new_page(); f_err = []
    pg.on('pageerror', lambda e: f_err.append(str(e)))
    wire(pg, 'fail')
    pg.goto(APP + '?today=2026-10-10')
    pg.wait_for_function("document.querySelector('#fc-status').textContent.includes('limit')")
    check('rate-limit reason shown to the user', 'Daily API request limit exceeded' in pg.inner_text('#fc-status'))
    check('no crash on API failure', not f_err, f_err)
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
