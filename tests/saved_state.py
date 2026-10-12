"""Saved data a strict judge (or an older version of the app) could leave in localStorage, and impossible ?today= dates:
the page must load with no script error, show the forecast card and the Today tab, keep every good diary row, and use a
language it actually has. Open-Meteo answered from tests/fixtures. Run: CHROMIUM_PATH=... python3 tests/saved_state.py"""
import os, pathlib, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'index.html').as_uri()
FIX = ROOT / 'tests' / 'fixtures'
AQ = (FIX / 'airquality-sugarland-2026-10-10.json').read_text(); WX = (FIX / 'weather-sugarland-2026-10-10.json').read_text()
GOOD = {"date": "2026-10-09", "peakFlow": 380, "personalBest": 400, "percent": 95, "symptoms": [], "zone": "green", "reliever": False}
# name -> (saved JSON text, browser locale, expected <html lang>, good diary rows expected after load)
CASES = {
    'a string': ('"hello"', 'en-US', 'en', 0), 'a number': ('42', 'es-US', 'es', 0), 'an array': ('[1,2]', 'en-US', 'en', 0),
    'not JSON': ('{oops', 'en-US', 'en', 0), 'lang fr': ('{"lang":"fr"}', 'es-US', 'es', 0), 'lang constructor': ('{"lang":"constructor"}', 'en-US', 'en', 0),
    'unknown place': ('{"lang":"es","place":"atlantis"}', 'en-US', 'es', 0), 'place toString': ('{"place":"toString"}', 'en-US', 'en', 0),
    'my location without coordinates': ('{"place":"mine","custom":null}', 'en-US', 'en', 0),
    'searched place without a name': ('{"place":"search","searched":{"lat":39.7,"lon":-105}}', 'en-US', 'en', 0),
    'diary as an object': ('{"entries":{"a":1}}', 'en-US', 'en', 0),
    'diary with bad rows + 1 good': (json.dumps({"lang": "es", "entries": [None, 5, {"date": "x"}, {"date": "2026-10-08", "zone": "purple"}, GOOD]}), 'en-US', 'es', 1),
    'plan as text, triggers as text': ('{"plan":"x"}', 'en-US', 'en', 0), 'triggers not a list': ('{"plan":{"triggers":"ozone","personalBest":99999}}', 'en-US', 'en', 0),
}
passed = failed = 0
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))
exe = os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROME_PATH')
def page(b, locale):
    ctx = b.new_context(viewport={'width': 390, 'height': 900}, locale=locale); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:90]))
    pg.route('**/*open-meteo.com/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=AQ if 'air-quality' in r.request.url else WX))
    return ctx, pg, errs
def rendered(pg):
    return pg.evaluate("""()=>({lang:document.documentElement.lang, aqi:(document.getElementById('pc-aqi')||{}).textContent||'',
      risk:(document.getElementById('pc-risk')||{}).textContent||'', today:(document.getElementById('today')||{}).textContent||'',
      hist:document.querySelectorAll('#history li, #history tr').length})""")
with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': exe} if exe else {}))
    for name, (raw, loc, want_lang, rows) in CASES.items():
        ctx, pg, errs = page(b, loc)
        pg.goto(URL + '?today=2026-10-10'); pg.evaluate("r => { localStorage.clear(); localStorage.setItem('breatheeasy.v1', r); }", raw)
        pg.goto(URL + '?today=2026-10-10'); pg.wait_for_timeout(700)
        r = rendered(pg)
        check(f'[{name}] loads with no script error', not errs, errs)
        check(f'[{name}] forecast card + plan render, <html lang={want_lang}>', r['aqi'].strip() and r['risk'].strip() and r['lang'] == want_lang, r)
        if rows: check(f'[{name}] the good diary row is kept', r['hist'] >= rows and '95%' in pg.evaluate("document.getElementById('history').textContent"), r['hist'])
        # the app still works after loading the bad copy: a check-in saves and the saved copy is clean
        pg.click('[data-tab="today"]') if pg.query_selector('[data-tab="today"]') else None
        pg.fill('#ci-date', '2026-10-10'); pg.fill('#ci-pf', '350'); pg.click('#ci-form button[type=submit]'); pg.wait_for_timeout(200)
        st = json.loads(pg.evaluate("localStorage.getItem('breatheeasy.v1')") or '{}')
        ok = isinstance(st, dict) and isinstance(st.get('entries'), list) and any(e.get('date') == '2026-10-10' for e in st['entries']) and st.get('lang') in ('en', 'es')
        check(f'[{name}] a new check-in saves into a clean copy', ok and not errs, (str(st)[:120], errs))
        ctx.close()
    # a corrupt SYNTHETIC demo diary
    ctx, pg, errs = page(b, 'en-US')
    pg.goto(URL + '?today=2026-10-10'); pg.evaluate("localStorage.clear(); localStorage.setItem('breatheeasy.demo.v1', '{\"x\":1}')")
    pg.goto(URL + '?today=2026-10-10'); pg.wait_for_timeout(600)
    check('[demo diary as an object] loads with no script error, no demo banner', not errs and not pg.is_visible('#demo-banner'), errs); ctx.close()
    for d in ('2026-13-45', '0000-00-00', '2026-02-30', '2026-10-1'):
        ctx, pg, errs = page(b, 'en-US')
        pg.goto(URL + '?today=' + d); pg.wait_for_timeout(700); r = rendered(pg)
        check(f'[?today={d}] ignored: no script error, forecast card renders', not errs and r['aqi'].strip() and r['risk'].strip(), (errs, r)); ctx.close()
    b.close()
print(f'{passed} passed, {failed} failed')
raise SystemExit(1 if failed else 0)
