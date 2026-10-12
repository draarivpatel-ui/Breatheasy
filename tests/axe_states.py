"""axe-core sweep of every BreatheEasy state at 390 and 1280 px, EN and ES, plus a mid-flow language switch.
States: first load (fixtures), demo data + insights, check-in errors, check-in saved, plan errors, plan saved,
city results (same-looking names), city not found, city search down, forecast down (429), offline.
Run: CHROMIUM_PATH=... python3 tests/axe_states.py   (ONLY_VW=390|1280 and ONLY_LANG=en|es split it into shorter runs)   (AXE_JS=/path/axe.min.js optional)"""
import os, sys, pathlib, json, urllib.request
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / 'index.html').as_uri()
FIX = ROOT / 'tests' / 'fixtures'
AQ = (FIX / 'airquality-sugarland-2026-10-10.json').read_text()
WX = (FIX / 'weather-sugarland-2026-10-10.json').read_text()
GEO = (FIX / 'geocode-london-2026-10-11.json').read_text()
GEO_LONG = (FIX / 'geocode-long-names-synthetic.json').read_text()
PATHS = [os.environ.get('AXE_JS', ''), str(ROOT / 'node_modules/axe-core/axe.min.js'),
         '/workspace/work/hackathons/eurekadev_qa/node_modules/axe-core/axe.min.js']
AXE = next((open(p).read() for p in PATHS if p and os.path.exists(p)), None) or \
    urllib.request.urlopen('https://cdn.jsdelivr.net/npm/axe-core@4.14.0/axe.min.js', timeout=30).read().decode()
passed = failed = 0
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))
CORS = {'access-control-allow-origin': '*'}
mode = {'v': 'ok'}
def wire(page):
    def handle(route):
        url = route.request.url
        if mode['v'] == 'fail': return route.fulfill(status=429, content_type='application/json', headers=CORS, body=json.dumps({'error': True, 'reason': 'Daily API request limit exceeded'}))
        if mode['v'] == 'offline': return route.abort('internetdisconnected')
        if 'geocoding-api' in url:
            if 'name=Zzqx' in url: return route.fulfill(status=200, content_type='application/json', headers=CORS, body='{"generationtime_ms":0.2}')
            if 'name=Springfield' in url: return route.fulfill(status=200, content_type='application/json', headers=CORS, body=GEO_LONG)
            if 'name=Fail' in url: return route.fulfill(status=503, content_type='application/json', headers=CORS, body='{"error":true}')
            return route.fulfill(status=200, content_type='application/json', headers=CORS, body=GEO)
        route.fulfill(status=200, content_type='application/json', headers=CORS, body=AQ if 'air-quality-api' in url else WX)
    page.route('**/*open-meteo.com/**', handle)
def axe(pg, tag):
    if not pg.evaluate('!!window.axe'): pg.add_script_tag(content=AXE)
    v = pg.evaluate("""async()=>{const r=await axe.run(document,{resultTypes:['violations']});
      return r.violations.map(v=>v.id+' x'+v.nodes.length+' '+v.nodes.slice(0,2).map(n=>n.target.join(' ')).join(' | '))}""")
    check(f'[{tag}] axe 0 violations', not v, v)
def overflow(pg, tag):
    w = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    check(f'[{tag}] no sideways scroll', w <= 0, f'{w}px')
def setlang(pg, L): pg.select_option('#lang', L); pg.wait_for_timeout(200)
def city(pg, q): pg.fill('#place-q', q); pg.press('#place-q', 'Enter'); pg.wait_for_timeout(500)

def first_load(pg): pass
def demo(pg): pg.click('#demo-toggle'); pg.wait_for_timeout(400)
def checkin_errors(pg): pg.fill('#ci-pf', '5000'); pg.click('#ci-form button[type=submit]'); pg.wait_for_timeout(150)
def checkin_saved(pg): pg.fill('#ci-pf', '410'); pg.click('#ci-form button[type=submit]'); pg.wait_for_timeout(250)
def plan_errors(pg): pg.fill('#p-best', '20'); pg.click('#plan-form button[type=submit]'); pg.wait_for_timeout(150)
def plan_saved(pg):
    pg.fill('#p-best', '420'); pg.fill('#p-ex', 'Albuterol 2 puffs'); pg.fill('#p-phone', '555-0100')
    pg.click('#plan-form button[type=submit]'); pg.wait_for_timeout(250)
def city_results(pg): city(pg, 'Springfield')
def city_not_found(pg): city(pg, 'Zzqx')
def city_down(pg): city(pg, 'Fail')
def forecast_down(pg): mode['v'] = 'fail'; pg.click('#refresh'); pg.wait_for_timeout(800)
def offline(pg): mode['v'] = 'offline'; pg.click('#refresh'); pg.wait_for_timeout(800)
STATES = [first_load, demo, checkin_errors, checkin_saved, plan_errors, plan_saved, city_results, city_not_found, city_down, forecast_down, offline]
only = os.environ.get('ONLY_VW')
kw = {'executable_path': os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROME_PATH')} if (os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROME_PATH')) else {}
with sync_playwright() as p:
    b = p.chromium.launch(**kw)
    for vw in (390, 1280):
        if only and str(vw) != only: continue
        for L in ('en', 'es'):
            if os.environ.get('ONLY_LANG') and L != os.environ['ONLY_LANG']: continue
            for fn in STATES:
                tag = f'{vw}-{L} {fn.__name__}'; mode['v'] = 'ok'
                ctx = b.new_context(viewport={'width': vw, 'height': 900}, locale='en-US', bypass_csp=True); pg = ctx.new_page(); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept()); wire(pg)
                pg.goto(APP + '?today=2026-10-10'); pg.evaluate('localStorage.clear()'); pg.goto(APP + '?today=2026-10-10'); pg.wait_for_timeout(500)
                if L == 'es': setlang(pg, 'es')
                try: fn(pg)
                except Exception as e: check(f'[{tag}] state reached', False, str(e)[:160]); ctx.close(); continue
                pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
                axe(pg, tag); overflow(pg, tag)
                other = 'en' if L == 'es' else 'es'
                setlang(pg, other); axe(pg, f'{tag} ->{other}')
                check(f'[{tag}] <html lang> follows switch', pg.evaluate('document.documentElement.lang') == other)
                check(f'[{tag}] no page errors', not errs, errs[:2])
                ctx.close()
    b.close()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
