"""axe-core baseline guard for BreatheEasy (added Oct 12, 2026 after an accessibility audit; tests only, no app change).
Runs axe-core 4.14.0 with the WCAG 2.0/2.1/2.2 A+AA and best-practice tags on the main views at 360 and 1280 px.
The 2.2 tag also switches on `target-size` (WCAG 2.5.8), which axe leaves off by default and the other axe suites
here do not run. It fails only on a NEW serious or critical violation: a (rule, element) pair not listed in BASELINE.
Moderate/minor results are printed, not failed (tests/axe_states.py already requires 0 violations of every impact
for the WCAG 2.1 rule set).
Run: CHROMIUM_PATH=/usr/bin/chromium python3 tests/axe_baseline.py   (AXE_JS=/path/axe.min.js optional)"""
import os, re, sys, json, pathlib, urllib.request
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = (ROOT / 'index.html').as_uri()
FIX = ROOT / 'tests' / 'fixtures'
AQ = (FIX / 'airquality-sugarland-2026-10-10.json').read_text()
WX = (FIX / 'weather-sugarland-2026-10-10.json').read_text()
GEO_LONG = (FIX / 'geocode-long-names-synthetic.json').read_text()
# Serious/critical violations accepted at the Oct 12, 2026 audit: (rule id, regex on the axe target, why).
# Fix is queued for after DSH Hacks judging; the app is frozen until then.
BASELINE = [
    ('target-size', r'^input\[value="[a-z_]+"\]$',
     'symptom/trigger checkboxes are 22x22 px; at some widths the gap to the next one is under 24 px (WCAG 2.5.8). '
     'The whole <label class="chk"> is clickable, but axe measures the box. Fix: 24 px boxes or more row gap.'),
]

# ---- shared core (same in all four repos) ----
TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
AXE_VERSION = '4.14.0'
PATHS = [os.environ.get('AXE_JS', ''), str(ROOT / 'node_modules/axe-core/axe.min.js')]
AXE = next((open(p).read() for p in PATHS if p and os.path.exists(p)), None) or \
    urllib.request.urlopen(f'https://cdn.jsdelivr.net/npm/axe-core@{AXE_VERSION}/axe.min.js', timeout=30).read().decode()
passed = failed = 0
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('  -> ' + str(info) if info else ''))
def known(rule, target):
    return any(rule == r and re.search(pat, target) for r, pat, _why in BASELINE)
def axe_new_serious(pg, tag):
    if not pg.evaluate('!!window.axe'): pg.add_script_tag(content=AXE)
    res = pg.evaluate("""async(tags)=>{const r=await axe.run(document,{runOnly:{type:'tag',values:tags},resultTypes:['violations']});
      return {v:axe.version,list:r.violations.flatMap(x=>x.nodes.map(n=>({id:x.id,impact:n.impact||x.impact,t:n.target.join(' ')})))}}""", TAGS)
    new = [x for x in res['list'] if x['impact'] in ('serious', 'critical') and not known(x['id'], x['t'])]
    other = sorted({f"{x['id']}({x['impact']})" for x in res['list'] if x not in new})
    if other: print(f'  info [{tag}] baseline/lower-impact, not failed: {other}')
    check(f'[{tag}] axe {res["v"]} WCAG 2.2 AA + best-practice: no new serious/critical violation', not new,
          [f"{x['id']}({x['impact']}) {x['t']}" for x in new][:6])
CORS = {'access-control-allow-origin': '*'}
def wire(page):  # Open-Meteo answered from the saved fixtures, so the run is deterministic
    def handle(route):
        url = route.request.url
        if 'geocoding-api' in url: return route.fulfill(status=200, content_type='application/json', headers=CORS, body=GEO_LONG)
        route.fulfill(status=200, content_type='application/json', headers=CORS, body=AQ if 'air-quality-api' in url else WX)
    page.route('**/*open-meteo.com/**', handle)
def w(pg, ms=250): pg.wait_for_timeout(ms)
def plan_saved(pg):
    pg.fill('#p-best', '420'); pg.fill('#p-ex', 'Albuterol 2 puffs'); pg.fill('#p-phone', '555-0100')
    pg.click('#plan-form button[type=submit]'); w(pg)
VIEWS = [
    ('first load', lambda pg: None),
    ('demo data + insights', lambda pg: (pg.click('#demo-toggle'), w(pg, 400))),
    ('check-in errors', lambda pg: (pg.fill('#ci-pf', '5000'), pg.click('#ci-form button[type=submit]'), w(pg))),
    ('plan saved', plan_saved),
    ('city results', lambda pg: (pg.fill('#place-q', 'Springfield'), pg.press('#place-q', 'Enter'), w(pg, 500))),
]
kw = {'executable_path': os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROME_PATH')} if (os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROME_PATH')) else {}
with sync_playwright() as p:
    b = p.chromium.launch(**kw)
    for vw in (360, 1280):
        for name, fn in VIEWS:
            tag = f'{vw} {name}'
            ctx = b.new_context(viewport={'width': vw, 'height': 800}, locale='en-US', bypass_csp=True); pg = ctx.new_page()
            pg.on('dialog', lambda d: d.accept()); wire(pg)
            pg.goto(APP + '?today=2026-10-10'); pg.evaluate('localStorage.clear()'); pg.goto(APP + '?today=2026-10-10'); w(pg, 500)
            try: fn(pg)
            except Exception as e: check(f'[{tag}] view reached', False, str(e)[:160]); ctx.close(); continue
            pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
            axe_new_serious(pg, tag); ctx.close()
    b.close()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
