"""No flash of English for Spanish visitors, and the 3 s fail-safe. Real Chromium, 390 px.
The app script is held back on purpose, so we can look at the page in the gap before it runs.
Run: python3 tests/lang_flash.py   (optional CHROME_PATH / CHROMIUM_PATH)"""
import os, sys, socket, subprocess, time, threading, pathlib, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
APP_JS = 'js/app.js'          # the script that applies the language
QUERY = 'today=2026-10-10'           # extra query string every visit uses
ES_HEADING = 'Pronóstico del aire'        # Spanish text that must be on screen once the app has run
EN_HEADING = 'Air outlook'
HEAD_SEL = '#today-h'
STORE_KEY = 'breatheeasy.v1'       # '' when the language is not stored
s = socket.socket(); s.bind(('127.0.0.1', 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://127.0.0.1:{PORT}/'
passed = failed = 0
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))
def visible(pg): return pg.evaluate("getComputedStyle(document.body).visibility")
def heading(pg): return pg.evaluate(f"(document.querySelector({json.dumps(HEAD_SEL)})||{{textContent:''}}).textContent.trim()")
exe = os.environ.get('CHROME_PATH') or os.environ.get('CHROMIUM_PATH')
with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': exe} if exe else {}))
    def page(locale, hold=None, block=False, stored=None):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale=locale, service_workers='block')
        pg = ctx.new_page()
        if stored is not None and STORE_KEY:
            pg.add_init_script(f"try{{if(!sessionStorage.getItem('__seeded')){{localStorage.setItem({json.dumps(STORE_KEY)}, {json.dumps(json.dumps(stored))});sessionStorage.setItem('__seeded','1')}}}}catch(e){{}}")
        held = []
        def r(route):
            if block: return route.abort()
            if hold: return held.append(route)   # answered later by release()
            route.continue_()
        pg.route(f'**/{APP_JS}*', r)
        pg._held = held
        pg.route('**/*open-meteo.com/**', lambda r: r.abort())
        pg.route('**/*weather.gov/**', lambda r: r.abort())
        return ctx, pg
    def release(pg):
        while pg._held: pg._held.pop().continue_()
        pg.wait_for_timeout(50)
    def go(pg, q=''):
        sep = '&' if QUERY else ''
        pg.goto(BASE + '?' + QUERY + (sep + q if q else ''), wait_until='commit'); pg.wait_for_function("document.body && getComputedStyle(document.body).visibility")
        pg.wait_for_timeout(600)

    # 1. Spanish browser, app script slow: page waits hidden instead of showing English, then shows Spanish.
    ctx, pg = page('es-US', hold=True); go(pg)
    check('es: body hidden while the app script loads (no English flash)', visible(pg) == 'hidden', visible(pg))
    check('es: <html lang> already es before the app runs', pg.evaluate('document.documentElement.lang') == 'es')
    release(pg); pg.wait_for_function("getComputedStyle(document.body).visibility==='visible'", timeout=8000)
    check('es: shown in Spanish once the app ran', ES_HEADING in heading(pg), heading(pg))
    check('es: shown before the 3 s fail-safe (the app revealed it)', pg.evaluate("performance.now()") < 2900, pg.evaluate("performance.now()"))
    ctx.close()
    # 2. English browser: never hidden.
    ctx, pg = page('en-US', hold=True); go(pg)
    check('en: body visible straight away', visible(pg) == 'visible', visible(pg))
    check('en: English heading', EN_HEADING in heading(pg), heading(pg))
    release(pg); ctx.close()
    # 3. Spanish browser, app script never arrives: fail-safe shows the page after 3 s.
    ctx, pg = page('es-US', block=True); go(pg)
    check('fail-safe: hidden at first', visible(pg) == 'hidden', visible(pg))
    pg.wait_for_timeout(3200)
    check('fail-safe: visible after 3 s even with no app script', visible(pg) == 'visible', visible(pg))
    ctx.close()
    # 4. A saved language choice wins over the browser language, same as js/app.js.
    for loc, lang, hid, name in (('es-US', 'en', 'visible', 'saved EN on a Spanish browser'), ('en-US', 'es', 'hidden', 'saved ES on an English browser')):
        ctx, pg = page(loc, hold=True, stored={'lang': lang, 'place': 'sugarland', 'custom': None, 'plan': {'triggers': []}, 'entries': []}); go(pg)
        check(f'{name}: body {hid} before the app runs', visible(pg) == hid, visible(pg))
        release(pg); pg.wait_for_function("getComputedStyle(document.body).visibility==='visible'", timeout=8000)
        want = ES_HEADING if lang == 'es' else EN_HEADING
        check(f'{name}: right language once shown', want in heading(pg), heading(pg))
        ctx.close()
    # 5. Broken saved data must not hide the page for good: falls back to the browser language.
    ctx, pg = page('en-US'); pg.add_init_script("try{localStorage.setItem('breatheeasy.v1','{not json')}catch(e){}"); go(pg)
    check('corrupt saved data on an English browser: visible, no error hides it', visible(pg) == 'visible', visible(pg))
    ctx.close()
    # 6. Mid-flow switch after load never hides the page.
    ctx, pg = page('es-US'); go(pg); release(pg); pg.wait_for_function("getComputedStyle(document.body).visibility==='visible'", timeout=8000)
    pg.select_option('#lang', 'en'); pg.wait_for_timeout(100); a = visible(pg); pg.select_option('#lang', 'es'); pg.wait_for_timeout(100)
    check('switching EN/ES after load keeps the page visible', a == 'visible' and visible(pg) == 'visible' and ES_HEADING in heading(pg))
    ctx.close()
    b.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
