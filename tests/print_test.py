"""Print check for BreatheEasy's "Print plan" (real Chromium Letter PDFs + poppler's pdfinfo/pdftotext).
For English and Spanish x {plain, one-tap SYNTHETIC demo, demo + a long personal pre-exercise step + every trigger}:
the plan prints on ONE Letter page, names the place, shows tomorrow's AQI and category, keeps the 911 line,
labels SYNTHETIC data, includes the user's own words, and leaves the on-screen controls off the paper.
Open-Meteo is answered from tests/fixtures (the real 2026-10-10 Sugar Land forecast), clock pinned with ?today=.
Run: python3 tests/print_test.py   (CHROMIUM_PATH=/usr/bin/chromium optional; needs pdfinfo + pdftotext)"""
import os, pathlib, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT / 'tests' / 'fixtures'
AQ = (FIX / 'airquality-sugarland-2026-10-10.json').read_text()
WX = (FIX / 'weather-sugarland-2026-10-10.json').read_text()
EX = 'Take 2 puffs of the blue inhaler 15 minutes before practice, warm up for 10 minutes, and carry the inhaler in the bag at all times during the game.'
W = {'en': dict(place='Place', city='Sugar Land, TX', cat='Unhealthy for sensitive groups', n911='Call 911 now', syn='SYNTHETIC demo data', ui=['Refresh', 'Or find any city', 'Add to calendar', 'Print plan', 'Daily check-in']),
     'es': dict(place='Lugar', city='Sugar Land, TX', cat='Insalubre para grupos sensibles', n911='Llama al 911 ahora', syn='demostración SINTÉTICOS', ui=['Actualizar', 'O busca cualquier ciudad', 'Agregar al calendario', 'Imprimir plan', 'Registro diario'])}
passed = failed = 0
def check(name, cond, info=''):
    global passed, failed
    if cond: passed += 1; print('  ok   ' + name)
    else: failed += 1; print('  FAIL ' + name + ('  -> ' + str(info)[:300] if info else ''))
kw = {'executable_path': os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}
tmp = pathlib.Path(tempfile.mkdtemp())
with sync_playwright() as p:
    b = p.chromium.launch(**kw)
    for lang in ('en', 'es'):
        w = W[lang]
        pg = b.new_page(viewport={'width': 1280, 'height': 900}, locale='es-US' if lang == 'es' else 'en-US')
        pg.route('**/*open-meteo.com/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=AQ if 'air-quality' in r.request.url else WX))
        pg.goto((ROOT / 'index.html').as_uri() + '?today=2026-10-09')
        pg.wait_for_function("document.querySelector('#pc-aqi .aqi-num').textContent !== '-'")
        if pg.evaluate('document.documentElement.lang') != lang: pg.select_option('#lang', lang); pg.wait_for_timeout(200)
        for st in ('plain', 'demo', 'max'):
            if st == 'demo': pg.click('#try-demo'); pg.wait_for_timeout(500)
            if st == 'max':
                pg.fill('#p-best', '400'); pg.fill('#p-ex', EX)
                for c in pg.locator('#p-triggers input').all(): c.check()
                pg.locator('#plan-form button[type=submit]').click(); pg.wait_for_timeout(500)
            pdf = tmp / f'{lang}-{st}.pdf'
            pg.pdf(path=str(pdf), format='Letter', print_background=True)
            info = subprocess.run(['pdfinfo', str(pdf)], capture_output=True, text=True).stdout
            pages = int([l.split()[-1] for l in info.splitlines() if l.startswith('Pages:')][0])
            txt = subprocess.run(['pdftotext', str(pdf), '-'], capture_output=True, text=True).stdout
            flat = ' '.join(txt.split())
            tag = f'{lang} {st}:'
            check(f'{tag} plan prints on one Letter page', pages == 1, pages)
            check(f'{tag} names the place ({w["place"]}: {w["city"]})', w['place'] in flat and w['city'] in flat, flat[:300])
            check(f'{tag} tomorrow AQI 140 + category', '140' in flat and w['cat'] in flat)
            check(f'{tag} keeps the 911 safety line as text', w['n911'] in flat)
            check(f'{tag} no on-screen controls on paper', not [u for u in w['ui'] if u in flat], [u for u in w['ui'] if u in flat])
            if st != 'plain': check(f'{tag} SYNTHETIC demo outlook is labelled on paper', w['syn'] in flat, flat[-600:])
            if st == 'max': check(f'{tag} the user\'s own pre-exercise words print in full', ' '.join(EX.split()) in flat)
            check(f'{tag} next-days strip printed (Today/Hoy)', ('Today' if lang == 'en' else 'Hoy') in flat)
        pg.close()
    b.close()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
