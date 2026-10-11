/* BreatheEasy UI. All state lives in localStorage on this device. */
(function () {
  'use strict';
  var AQI = window.BE_AQI, Z = window.BE_Zones, F = window.BE_Forecast, M = window.BE_Model,
    G = window.BE_Guidance, DEMO = window.BE_Demo, ICS = window.BE_ICS, I = window.BE_I18N, SH = window.BE_Share;

  var KEY = 'breatheeasy.v1', DEMO_KEY = 'breatheeasy.demo.v1', FC_KEY = 'breatheeasy.forecast.v1';
  var PLACES = {
    sugarland: { lat: 29.6197, lon: -95.6349, key: 'loc_sugarland' },
    houston: { lat: 29.7604, lon: -95.3698, key: 'loc_houston' },
    pasadena: { lat: 29.6911, lon: -95.2091, key: 'loc_pasadena' }
  };
  var TRIGGERS = ['ozone', 'smoke', 'pollen', 'heat', 'mold', 'cold'];

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (a) { if (a === 'class') n.className = attrs[a]; else n.setAttribute(a, attrs[a]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function isoLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(iso, n) { return DEMO.addDays(iso, n); }

  var state = load(KEY, null) || { lang: (navigator.language || 'en').slice(0, 2) === 'es' ? 'es' : 'en', place: 'sugarland', custom: null, plan: { triggers: [] }, entries: [] };
  state.entries = state.entries || []; state.plan = state.plan || { triggers: [] };
  var demo = load(DEMO_KEY, null); // array of synthetic entries or null
  var forecast = load(FC_KEY, null); // {days, fetchedAt, place}
  var fcError = null;

  // Allow a fixed "today" for demos/tests: ?today=YYYY-MM-DD
  var qs = new URLSearchParams(location.search);
  var TODAY = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('today') || '') ? qs.get('today') : isoLocal(new Date());
  var TOMORROW = addDays(TODAY, 1);

  function t(k, p) { return I.t(state.lang, k, p); }
  function persist() { save(KEY, state); }

  function fmtDate(iso, opts) {
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(state.lang === 'es' ? 'es-US' : 'en-US', opts || { weekday: 'long', month: 'long', day: 'numeric' });
  }

  /* ---------- i18n ---------- */
  function applyI18n() {
    document.documentElement.lang = state.lang;
    $('#lang').value = state.lang;
    $$('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    $$('[data-only]').forEach(function (n) { n.hidden = n.getAttribute('data-only') !== state.lang; });
  }

  /* ---------- symptom + trigger checkboxes ---------- */
  function buildChecks() {
    var groups = { yellow: Z.YELLOW_SYMPTOMS, red: Z.RED_SYMPTOMS, danger: Z.DANGER_SIGNS };
    Object.keys(groups).forEach(function (g) {
      var box = $('.checks[data-group="' + g + '"]'); box.innerHTML = '';
      groups[g].forEach(function (s) {
        var lab = el('label', { class: 'chk' });
        var cb = el('input', { type: 'checkbox', name: 'sym', value: s });
        lab.appendChild(cb); lab.appendChild(el('span', { 'data-i18n': 's_' + s }, t('s_' + s)));
        box.appendChild(lab);
      });
    });
    var tb = $('#p-triggers'); tb.innerHTML = '';
    TRIGGERS.forEach(function (k) {
      var lab = el('label', { class: 'chk' });
      var cb = el('input', { type: 'checkbox', name: 'trig', value: k });
      lab.appendChild(cb); lab.appendChild(el('span', { 'data-i18n': 't_' + k }, t('t_' + k)));
      tb.appendChild(lab);
    });
  }

  /* ---------- forecast ---------- */
  function coords() {
    if (state.place === 'mine' && state.custom) return state.custom;
    return PLACES[state.place] || PLACES.sugarland;
  }
  function placeName() { return state.place === 'mine' ? t('loc_mine_name') : t((PLACES[state.place] || PLACES.sugarland).key); }

  function fetchForecast() {
    var c = coords();
    $('#fc-status').textContent = t('loading');
    fcError = null;
    return F.load(c.lat, c.lon).then(function (res) {
      forecast = { days: res.days, fetchedAt: res.fetchedAt, place: state.place };
      save(FC_KEY, forecast);
      $('#fc-status').textContent = '';
    }).catch(function (err) {
      fcError = (err && err.message) || 'network error';
      $('#fc-status').textContent = t('forecast_error', { reason: fcError });
    }).then(renderAll);
  }

  function dayFor(iso) {
    if (!forecast || !forecast.days) return null;
    for (var i = 0; i < forecast.days.length; i++) if (forecast.days[i].date === iso) return forecast.days[i];
    return null;
  }

  /* ---------- model ---------- */
  function trainingEntries() { return demo && demo.length ? demo : state.entries; }
  function trained() { return M.train(trainingEntries()); }

  function featuresFor(iso) {
    var d = dayFor(iso) || {};
    var src = trainingEntries();
    var prev = src.filter(function (e) { return e.date === addDays(iso, -1); })[0];
    var pollen = d.pollenLevel;
    if (pollen == null) { var todays = src.filter(function (e) { return e.date === TODAY; })[0]; if (todays && todays.pollenLevel != null && iso === TOMORROW) pollen = todays.pollenLevel; }
    return { aqiO3: d.aqiO3, aqiPM25: d.aqiPM25, pollenLevel: pollen, tempMaxF: d.tempMaxF, humidity: d.humidity, prevBad: prev ? M.label(prev) : null };
  }

  /* ---------- render: plan card ---------- */
  function catLabel(cat) { return cat ? t('cat_' + cat.key) : ''; }

  function renderPlanCard() {
    var d = dayFor(TOMORROW);
    $('#pc-date').textContent = fmtDate(TOMORROW);
    var badge = $('#pc-aqi'), num = badge.querySelector('.aqi-num');
    var tr = trained(), risk = null, pred = null;
    if (tr.status === 'ready' && d) { pred = M.predict(tr.model, featuresFor(TOMORROW)); risk = M.band(pred.p); }
    var g = G.build(d || {}, state.plan, risk);
    if (d && g.category) {
      num.textContent = d.aqi;
      badge.style.background = g.category.color; badge.style.color = g.category.ink;
      badge.setAttribute('aria-label', t('aqi') + ' ' + d.aqi + ', ' + catLabel(g.category));
      $('#pc-cat').textContent = catLabel(g.category);
      $('#plan-card').setAttribute('data-cat', g.category.key);
    } else {
      num.textContent = '—'; badge.style.background = ''; badge.style.color = '';
      $('#pc-cat').textContent = forecast ? '' : t('forecast_none');
      $('#plan-card').removeAttribute('data-cat');
    }
    var facts = $('#pc-facts'); facts.innerHTML = '';
    function fact(k, v) { if (v == null || v === '') return; facts.appendChild(el('dt', null, k)); facts.appendChild(el('dd', null, v)); }
    if (d) {
      fact(t('dominant'), d.dominant ? t(d.dominant) : null);
      fact(t('ozone'), d.aqiO3 != null ? t('aqi') + ' ' + d.aqiO3 + (d.o3ppm != null ? ' (' + Math.round(d.o3ppm * 1000) + ' ppb, 8 h)' : '') : null);
      fact(t('pm25'), d.aqiPM25 != null ? t('aqi') + ' ' + d.aqiPM25 + (d.pm25 != null ? ' (' + d.pm25 + ' µg/m³, 24 h)' : '') : null);
      var loggedPollen = null;
      if (d.pollenLevel == null) { var te = state.entries.filter(function (e) { return e.date === TODAY; })[0]; if (te && te.pollenLevel != null) loggedPollen = te.pollenLevel; }
      fact(t('pollen'), d.pollenLevel != null ? t('pollen_' + d.pollenLevel) : loggedPollen != null ? t('pollen_logged', { level: t('pollen_' + loggedPollen) }) : t('pollen_na'));
      fact(t('high_temp'), d.tempMaxF != null ? Math.round(d.tempMaxF) + ' °F' : null);
    }
    var ul = $('#pc-items'); ul.innerHTML = '';
    g.items.forEach(function (it) {
      var li = el('li', { class: 'gi gi-' + it.key }, t(it.key, it.params));
      ul.appendChild(li);
    });
    var rp = $('#pc-risk');
    if (tr.status !== 'ready') rp.textContent = t('risk_none', { days: M.MIN_DAYS });
    else if (!pred) rp.textContent = t('forecast_none');
    else {
      rp.innerHTML = '';
      var b = el('span', { class: 'risk risk-' + risk }, t('risk_' + risk));
      rp.appendChild(b);
      rp.appendChild(document.createTextNode(' · ' + Math.round(pred.p * 100) + '%' + (demo ? ' (demo)' : '')));
    }
    var src = $('#fc-source');
    src.textContent = forecast && forecast.fetchedAt ? t('source_line', { time: new Date(forecast.fetchedAt).toLocaleString(state.lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) }) : '';
    if (d && d.openMeteoMaxAqi != null) src.textContent += ' · ' + t('om_ref', { v: d.openMeteoMaxAqi });
    return { day: d, guidance: g, risk: risk, pred: pred };
  }

  function renderStrip() {
    var ol = $('#strip'); ol.innerHTML = '';
    if (!forecast || !forecast.days) return;
    forecast.days.filter(function (d) { return d.date >= TODAY && d.aqi != null; }).slice(0, 4).forEach(function (d) {
      var cat = AQI.category(d.aqi);
      var li = el('li', { class: 'day' });
      li.appendChild(el('span', { class: 'd-name' }, d.date === TODAY ? t('today') : d.date === TOMORROW ? t('tomorrow') : fmtDate(d.date, { weekday: 'short' })));
      var chip = el('span', { class: 'd-aqi' }, String(d.aqi)); chip.style.background = cat.color; chip.style.color = cat.ink;
      li.appendChild(chip);
      li.appendChild(el('span', { class: 'd-cat' }, catLabel(cat)));
      li.appendChild(el('span', { class: 'd-dom' }, d.dominant ? t(d.dominant) : ''));
      ol.appendChild(li);
    });
  }

  /* ---------- render: plan form ---------- */
  function renderPlanForm() {
    var p = state.plan;
    $('#p-best').value = p.personalBest || '';
    $('#p-green').value = p.green || ''; $('#p-yellow').value = p.yellow || ''; $('#p-red').value = p.red || '';
    $('#p-ex').value = p.beforeExercise || ''; $('#p-phone').value = p.doctorPhone || '';
    $$('input[name="trig"]').forEach(function (cb) { cb.checked = (p.triggers || []).indexOf(cb.value) !== -1; });
    renderThresholds();
  }
  function renderThresholds() {
    var th = Z.thresholds($('#p-best').value);
    $('#p-thr').textContent = th ? t('thresholds', { g: th.greenMin, y: th.yellowMin, g1: th.greenMin - 1 }) : '';
    $('#ci-pf-hint').textContent = state.plan.personalBest ? t('peak_flow_hint', { best: state.plan.personalBest }) : t('peak_flow_hint_nobest');
  }

  /* ---------- check-in ---------- */
  function showResult(entry) {
    var box = $('#ci-result'); box.hidden = false; box.innerHTML = '';
    box.className = 'result zone-' + entry.zone;
    if (entry.danger) {
      var al = el('div', { class: 'danger-alert', role: 'alert' });
      al.appendChild(el('strong', null, t('danger_now')));
      var a = el('a', { class: 'btn-911', href: 'tel:911' }, t('call911')); al.appendChild(a);
      box.appendChild(al);
    }
    var h = el('p', { class: 'zone-name' }, t('zone_' + entry.zone) + ' · ' + t('zone_' + entry.zone + '_d'));
    box.appendChild(h);
    if (entry.percent != null) box.appendChild(el('p', null, t('pct_best', { pct: entry.percent })));
    var txt = state.plan[entry.zone];
    if (txt) { box.appendChild(el('p', { class: 'says' }, t('your_plan_says'))); box.appendChild(el('blockquote', null, txt)); }
    else box.appendChild(el('p', { class: 'fine' }, t('no_plan_text')));
    if (entry.zone === 'red') box.appendChild(el('p', { class: 'red-call' }, t('red_call')));
    if (entry.zone === 'red' && state.plan.doctorPhone) {
      var dl = el('a', { class: 'btn', href: 'tel:' + state.plan.doctorPhone.replace(/[^\d+]/g, '') }, t('doctor_phone') + ': ' + state.plan.doctorPhone);
      box.appendChild(dl);
    }
  }

  function onCheckin(ev) {
    ev.preventDefault();
    var date = $('#ci-date').value || TODAY;
    var pf = $('#ci-pf').value ? Number($('#ci-pf').value) : null;
    var symptoms = $$('input[name="sym"]:checked').map(function (c) { return c.value; });
    var a = Z.assess({ peakFlow: pf, personalBest: state.plan.personalBest, symptoms: symptoms });
    var d = dayFor(date) || {};
    var pollenSel = $('#ci-pollen').value;
    var entry = {
      date: date, peakFlow: pf, personalBest: state.plan.personalBest || null, percent: a.percent,
      symptoms: symptoms, zone: a.zone, danger: a.danger, reliever: $('#ci-reliever').checked,
      aqiO3: d.aqiO3 != null ? d.aqiO3 : null, aqiPM25: d.aqiPM25 != null ? d.aqiPM25 : null,
      pollenLevel: pollenSel !== '' ? Number(pollenSel) : (d.pollenLevel != null ? d.pollenLevel : null),
      tempMaxF: d.tempMaxF != null ? d.tempMaxF : null, humidity: d.humidity != null ? d.humidity : null
    };
    state.entries = state.entries.filter(function (e) { return e.date !== date; }).concat([entry])
      .sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    persist();
    showResult(entry);
    renderInsights(); renderPlanCard();
    if (a.danger) $('#ci-result .danger-alert').focus && $('#ci-result').scrollIntoView({ block: 'center' });
  }

  /* ---------- insights ---------- */
  function renderInsights() {
    var banner = $('#demo-banner');
    banner.hidden = !demo; if (demo) banner.textContent = t('demo_banner', { n: demo.length });
    $('#demo-toggle').textContent = demo ? t('demo_clear') : t('demo_load');
    var tr = trained();
    var st = $('#model-status');
    if (tr.status !== 'ready') {
      st.textContent = t('model_status_need', { n: tr.days, d: tr.need.days, r: tr.need.rough, g: tr.need.good });
      $('#weights').hidden = true; $('#why').hidden = true;
    } else {
      st.textContent = t('model_status_ready', { n: tr.days, rough: tr.rough, good: tr.good });
      $('#weights').hidden = false;
      var max = Math.max.apply(null, tr.weights.map(function (w) { return Math.abs(w.weight); }).concat([0.01]));
      var chart = $('#weights-chart'); chart.innerHTML = '';
      var tb = $('#weights-table tbody'); tb.innerHTML = '';
      tr.weights.forEach(function (w) {
        var row = el('div', { class: 'wrow' });
        row.appendChild(el('span', { class: 'wlab' }, t('f_' + w.feature)));
        var track = el('span', { class: 'wtrack' });
        var bar = el('span', { class: 'wbar ' + (w.weight >= 0 ? 'pos' : 'neg') });
        bar.style.width = (Math.abs(w.weight) / max * 50) + '%';
        track.appendChild(bar); row.appendChild(track);
        chart.appendChild(row);
        var tr2 = el('tr');
        tr2.appendChild(el('th', { scope: 'row' }, t('f_' + w.feature)));
        tr2.appendChild(el('td', null, w.weight.toFixed(2)));
        tr2.appendChild(el('td', null, w.weight >= 0 ? t('dir_up') : t('dir_down')));
        tb.appendChild(tr2);
      });
      var ev = tr.evaluation;
      $('#eval').textContent = ev ? t('eval_line', { n: ev.testDays, acc: Math.round(ev.accuracy * 100), base: Math.round(ev.baseline * 100) }) : t('eval_none');
      var d = dayFor(TOMORROW);
      if (d) {
        var pred = M.predict(tr.model, featuresFor(TOMORROW));
        $('#why').hidden = false;
        $('#why-h').textContent = t('why_h', { band: t('risk_' + M.band(pred.p)).toLowerCase() });
        var ul = $('#why-list'); ul.innerHTML = '';
        pred.contributions.slice(0, 4).forEach(function (c) {
          var dayP = d.pollenLevel;
          var v = c.value == null ? '—' : c.key === 'pollenLevel' ? (dayP == null ? t('pollen_logged', { level: t('pollen_' + c.value) }) : t('pollen_' + c.value)) : c.key === 'prevBad' ? (c.value ? '✓' : '✗') : c.key === 'tempMaxF' ? Math.round(c.value) + ' °F' : c.key === 'humidity' ? Math.round(c.value) + '%' : String(c.value);
          ul.appendChild(el('li', { class: c.contribution >= 0 ? 'up' : 'down' }, t('f_' + c.feature) + ': ' + v + ' → ' + (c.contribution >= 0 ? '▲ ' + t('dir_up') : '▼ ' + t('dir_down'))));
        });
      } else $('#why').hidden = true;
    }
    var hist = $('#history'); hist.innerHTML = '';
    var src = trainingEntries().slice(-14).reverse();
    if (!src.length) hist.appendChild(el('li', { class: 'fine' }, t('history_none')));
    src.forEach(function (e) {
      var li = el('li', { class: 'h-item' });
      li.appendChild(el('span', { class: 'zchip z-' + e.zone }, t('zone_' + e.zone)));
      li.appendChild(el('span', null, fmtDate(e.date, { month: 'short', day: 'numeric' }) + (e.percent != null ? ' · ' + e.percent + '%' : '') + (e.aqiO3 != null ? ' · ' + t('ozone') + ' ' + e.aqiO3 : '') + (e.synthetic ? ' · demo' : '')));
      hist.appendChild(li);
    });
  }

  function renderAll() { applyI18n(); renderThresholds(); renderPlanCard(); renderStrip(); renderInsights(); }

  /* ---------- export / print ---------- */
  function download(name, mime, text) {
    var blob = new Blob([text], { type: mime });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function onIcs() {
    var r = renderPlanCard();
    var summary = 'BreatheEasy: ' + (r.day && r.guidance.category ? t('aqi') + ' ' + r.day.aqi + ' ' + catLabel(r.guidance.category) : t('tomorrow'));
    var desc = r.guidance.items.map(function (it) { return '• ' + t(it.key, it.params); }).join('\n') + '\n\n' + t('safety') + ' ' + t('safety_911');
    download('breatheeasy-' + TOMORROW + '.ics', 'text/calendar', ICS.allDayEvent(TOMORROW, summary, desc));
  }

  function shareText() {
    var r = renderPlanCard();
    var head = t('share_head', { date: fmtDate(TOMORROW), place: placeName() });
    var air = r.day && r.guidance.category ? t('share_air', { aqiLabel: t('aqi'), aqi: r.day.aqi, cat: catLabel(r.guidance.category), pol: r.day.dominant ? t(r.day.dominant) : '\u2014' }) : '';
    return SH.note({ heading: head, air: air, items: r.guidance.items.map(function (it) { return t(it.key, it.params); }), footer: [t('share_footer'), t('safety_911')] });
  }
  function copyShare() {
    var ta = $('#share-text'), msg = $('#share-msg');
    function manual() { ta.focus(); ta.select(); msg.textContent = t('share_manual'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { msg.textContent = t('share_copied'); }, manual);
    else manual();
  }
  function onShare() {
    var text = shareText();
    $('#share-box').hidden = false; $('#share-text').value = text; $('#share-msg').textContent = '';
    if (navigator.share) {
      navigator.share({ title: 'BreatheEasy', text: text }).then(function () { $('#share-msg').textContent = t('share_done'); }, function () { /* cancelled: text stays on screen */ });
    } else copyShare();
  }

  /* ---------- wire up ---------- */
  function init() {
    buildChecks(); applyI18n(); renderPlanForm();
    $('#loc').value = state.place;
    $('#ci-date').value = TODAY; $('#ci-date').max = TODAY;
    $('#lang').addEventListener('change', function () { state.lang = this.value; persist(); renderAll(); });
    $('#loc').addEventListener('change', function () {
      var v = this.value;
      if (v === 'mine') {
        if (!navigator.geolocation) { this.value = state.place; return; }
        var sel = this, prevName = placeName();
        navigator.geolocation.getCurrentPosition(function (pos) {
          state.place = 'mine'; state.custom = { lat: pos.coords.latitude, lon: pos.coords.longitude }; persist(); fetchForecast();
        }, function () { sel.value = state.place; $('#fc-status').textContent = t('geo_denied', { place: prevName }); }, { timeout: 10000, maximumAge: 600000 });
      } else { state.place = v; persist(); fetchForecast(); }
    });
    $('#refresh').addEventListener('click', fetchForecast);
    $('#p-best').addEventListener('input', renderThresholds);
    $('#plan-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var best = Number($('#p-best').value);
      state.plan = {
        personalBest: best > 0 ? best : null,
        green: $('#p-green').value.trim(), yellow: $('#p-yellow').value.trim(), red: $('#p-red').value.trim(),
        beforeExercise: $('#p-ex').value.trim(), doctorPhone: $('#p-phone').value.trim(),
        triggers: $$('input[name="trig"]:checked').map(function (c) { return c.value; })
      };
      persist(); $('#plan-msg').textContent = t('plan_saved'); renderAll();
    });
    $('#ci-form').addEventListener('submit', onCheckin);
    $('#demo-toggle').addEventListener('click', function () {
      if (demo) { demo = null; localStorage.removeItem(DEMO_KEY); }
      else { demo = DEMO.generate(TODAY, 75, 400, 42); save(DEMO_KEY, demo); }
      renderInsights(); renderPlanCard();
    });
    $('#ics').addEventListener('click', onIcs);
    $('#share').addEventListener('click', onShare);
    $('#share-copy').addEventListener('click', copyShare);
    $('#print').addEventListener('click', function () { window.print(); });
    $('#export').addEventListener('click', function () {
      download('breatheeasy-data.json', 'application/json', JSON.stringify({ exportedAt: new Date().toISOString(), plan: state.plan, entries: state.entries }, null, 2));
    });
    $('#wipe').addEventListener('click', function () {
      if (!window.confirm(t('wipe_confirm'))) return;
      [KEY, DEMO_KEY, FC_KEY].forEach(function (k) { localStorage.removeItem(k); });
      state = { lang: state.lang, place: 'sugarland', custom: null, plan: { triggers: [] }, entries: [] }; demo = null;
      persist(); renderPlanForm(); $('#ci-result').hidden = true; $('#data-msg').textContent = t('wiped'); renderAll(); fetchForecast();
    });
    if (qs.get('demo') === '1' && !demo) { demo = DEMO.generate(TODAY, 75, 400, 42); save(DEMO_KEY, demo); }
    renderAll();
    fetchForecast();
  }
  init();
})();
