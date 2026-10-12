"""Edge cases a strict judge tries, at 390 px in EN and ES: impossible peak-flow / personal-best numbers and future
check-in dates are refused with a clear message (nothing saved), and switching language mid-flow re-words the error,
"Plan saved", the check-in result and "All data deleted". Open-Meteo answered from tests/fixtures; clock pinned.
Run: CHROMIUM_PATH=... python3 tests/edge.py"""
import os, sys, pathlib, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / 'index.html').as_uri() + '?today=2026-10-10'
FIX = ROOT / 'tests' / 'fixtures'
AQ = (FIX / 'airquality-sugarland-2026-10-10.json').read_text(); WX = (FIX / 'weather-sugarland-2026-10-10.json').read_text()
passed = failed = 0
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))
def entries(pg): return len((json.loads(pg.evaluate("localStorage.getItem('breatheeasy.v1')") or '{}').get('entries') or []))
def best(pg): return (json.loads(pg.evaluate("localStorage.getItem('breatheeasy.v1')") or '{}').get('plan') or {}).get('personalBest')
exe = os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROME_PATH')
with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': exe} if exe else {}))
    for L, O in (('en', 'es'), ('es', 'en')):
        ctx = b.new_context(viewport={'width': 390, 'height': 900}, locale='en-US'); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/*open-meteo.com/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=AQ if 'air-quality' in r.request.url else WX))
        pg.goto(APP); pg.evaluate('localStorage.clear()'); pg.goto(APP); pg.wait_for_timeout(400)
        pg.select_option('#lang', L); pg.wait_for_timeout(150)
        txt = lambda k: pg.evaluate("k => document.getElementById(k).textContent.trim()", k)
        # what each message says in each language, read from the page after triggering it
        msgs = {}
        # --- check-in peak flow ---
        for v, ok in (('49', False), ('901', False), ('410.5', False), ('-5', False), ('1e3', False), ('0', False), ('50', True), ('900', True), ('', True), ('410', True)):
            n0 = entries(pg); pg.fill('#ci-date', '2026-10-10'); pg.fill('#ci-pf', v); pg.click('#ci-form button[type=submit]'); pg.wait_for_timeout(120)
            e = txt('ci-err'); inv = pg.get_attribute('#ci-pf', 'aria-invalid')
            if ok: check(f'[{L}] peak flow {v!r}: saved, no error', not e and inv is None and entries(pg) >= max(n0, 1), (e, inv))
            else:
                msgs.setdefault('pf', e)
                check(f'[{L}] peak flow {v!r}: refused with a message, box marked + focused, nothing saved', e and inv == 'true' and pg.evaluate('document.activeElement.id') == 'ci-pf' and entries(pg) == n0, (e[:50], inv, entries(pg), n0))
        # --- future date ---
        n0 = entries(pg); pg.fill('#ci-date', '2026-10-11'); pg.fill('#ci-pf', '400'); pg.click('#ci-form button[type=submit]'); pg.wait_for_timeout(120)
        e = txt('ci-err'); msgs['date'] = e
        check(f'[{L}] check-in for tomorrow: refused, date marked, nothing saved', e and pg.get_attribute('#ci-date', 'aria-invalid') == 'true' and entries(pg) == n0, (e[:50],))
        check(f'[{L}] date box caps at today (max attribute)', pg.get_attribute('#ci-date', 'max') == '2026-10-10')
        # mid-flow switch with the error showing
        pg.select_option('#lang', O); pg.wait_for_timeout(150); e2 = txt('ci-err')
        check(f'[{L}->{O}] check-in error re-worded on switch, field still marked', e2 and e2 != e and pg.get_attribute('#ci-date', 'aria-invalid') == 'true', (e[:40], e2[:40]))
        pg.select_option('#lang', L); pg.wait_for_timeout(150); check(f'[{L}->{O}->{L}] back to the first wording', txt('ci-err') == e)
        # fixing it clears the error; the result box follows a switch
        pg.fill('#ci-date', '2026-10-10'); pg.fill('#ci-pf', '400'); pg.click('#ci-form button[type=submit]'); pg.wait_for_timeout(150)
        r1 = pg.inner_text('#ci-result'); check(f'[{L}] fixed check-in saved, error gone', txt('ci-err') == '' and pg.get_attribute('#ci-date', 'aria-invalid') is None and r1)
        pg.select_option('#lang', O); pg.wait_for_timeout(150); r2 = pg.inner_text('#ci-result')
        check(f'[{L}->{O}] check-in result box re-worded on switch', r2 and r2 != r1, (r1[:40], r2[:40]))
        pg.select_option('#lang', L); pg.wait_for_timeout(150)
        # --- personal best ---
        for v, ok in (('0', False), ('49', False), ('901', False), ('99999', False), ('420.5', False), ('420', True), ('', True)):
            pg.fill('#p-best', v); pg.click('#plan-form button[type=submit]'); pg.wait_for_timeout(120)
            e = txt('plan-err'); saved = txt('plan-msg')
            if ok: check(f'[{L}] personal best {v!r}: saved', not e and saved and best(pg) == (int(v) if v else None), (e, saved, best(pg)))
            else:
                msgs.setdefault('best', e)
                check(f'[{L}] personal best {v!r}: refused, box marked, saved value unchanged, no "saved" note', e and pg.get_attribute('#p-best', 'aria-invalid') == 'true' and not saved and best(pg) in (None, 420), (e[:40], saved, best(pg)))
        pg.fill('#p-best', '99999'); pg.click('#plan-form button[type=submit]'); pg.wait_for_timeout(120); e = txt('plan-err')
        pg.select_option('#lang', O); pg.wait_for_timeout(150)
        check(f'[{L}->{O}] plan error re-worded on switch', txt('plan-err') and txt('plan-err') != e, txt('plan-err')[:40])
        pg.select_option('#lang', L); pg.wait_for_timeout(150)
        pg.fill('#p-best', '420'); pg.click('#plan-form button[type=submit]'); pg.wait_for_timeout(120); s1 = txt('plan-msg')
        pg.select_option('#lang', O); pg.wait_for_timeout(150)
        check(f'[{L}->{O}] "Plan saved" re-worded on switch', txt('plan-msg') and txt('plan-msg') != s1, (s1, txt('plan-msg')))
        pg.select_option('#lang', L); pg.wait_for_timeout(150)
        # --- delete everything, then switch ---
        pg.click('#wipe'); pg.wait_for_timeout(300); w1 = txt('data-msg')
        check(f'[{L}] delete-all clears errors and the saved note', w1 and txt('plan-msg') == '' and txt('plan-err') == '' and txt('ci-err') == '')
        pg.select_option('#lang', O); pg.wait_for_timeout(150)
        check(f'[{L}->{O}] "All data deleted" re-worded on switch', txt('data-msg') and txt('data-msg') != w1, (w1[:30], txt('data-msg')[:30]))
        check(f'[{L}] EN and ES messages differ (no English copied into Spanish)', all(msgs.values()))
        check(f'[{L}] no sideways scroll at 390 px', pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') <= 0)
        check(f'[{L}] no page errors', not errs, errs[:2])
        ctx.close()
    b.close()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
