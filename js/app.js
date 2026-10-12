/* BreatheEasy UI. All state lives in localStorage on this device. */
(function () {
  'use strict';
  var AQI = window.BE_AQI, Z = window.BE_Zones, F = window.BE_Forecast, M = window.BE_Model,
    G = window.BE_Guidance, P = window.BE_Places, FC = window.BE_FcCache, DEMO = window.BE_Demo, V = window.BE_Validate, ICS = window.BE_ICS, I = window.BE_I18N, SH = window.BE_Share;

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
  // One-line notes that must follow a language switch: form errors (i18n keys), 'Plan saved', 'All data deleted'.
  var formErr = { ci: null, plan: null }, planSaved = false, wiped = false, lastResult = null;
  // Forecast for the current place, from Open-Meteo or the per-place cache (js/fccache.js).
  // The old single-slot cache (FC_KEY) could show another city's forecast, so it is dropped.
  try { localStorage.removeItem(FC_KEY); } catch (e) { /* ignore */ }
  var forecast = null; // {days, fetchedAt, timezone}
  var fcMeta = null;   // {source: 'network'|'cache'|'fallback', savedAt, error?}
  var fcError = null;
  var fcSeq = 0;       // ignore answers for a place the user has already left
  var explainDate = null; // day picked in "Explain a past day"
  var trustWaiting = false;
  var trustResult = null; // SYNTHETIC model check, computed once (it never uses the user's data)

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
    document.documentElement.classList.remove('i18n-wait'); // set by the inline script in index.html for Spanish users
    $('#lang').value = state.lang;
    $$('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    if ($('#ics-msg')) $('#ics-msg').textContent = '';
    $$('[data-only]').forEach(function (n) { n.hidden = n.getAttribute('data-only') !== state.lang; });
    $('#place-q').placeholder = t('place_ph');
    if (placeMsg) $('#place-msg').textContent = placeMsg.reason ? placeErrorText() : t(placeMsg.key, placeMsg.params);
    // Form errors and the "Plan saved" note follow the language too.
    $('#ci-err').textContent = formErr.ci ? t(formErr.ci) : '';
    $('#plan-err').textContent = formErr.plan ? t(formErr.plan) : '';
    $('#plan-msg').textContent = planSaved ? t('plan_saved') : '';
    if (wiped) $('#data-msg').textContent = t('wiped');
    if (lastResult && !$('#ci-result').hidden) showResult(lastResult); // the check-in result box, re-worded
    var so = $('#loc-search-opt');
    so.hidden = !state.searched; so.textContent = state.searched ? state.searched.name : '';
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
    if (state.place === 'search' && state.searched) return state.searched;
    return PLACES[state.place] || PLACES.sugarland;
  }
  function placeName() {
    if (state.place === 'mine') return t('loc_mine_name');
    if (state.place === 'search' && state.searched) return state.searched.name;
    return t((PLACES[state.place] || PLACES.sugarland).key);
  }

  /* ---------- any-city search (Open-Meteo Geocoding) ---------- */
  var placeMsg = null; // {key, params}: re-worded when the language changes
  function setPlaceMsg(key, params) { placeMsg = key ? { key: key, params: params } : null; $('#place-msg').textContent = key ? t(key, params) : ''; }
  function placeErrorText() { return t('place_error', { place: placeMsg.params.place, reason: t(placeMsg.reason.key, placeMsg.reason.params) }); }
  function placeReason(err) {
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) return { key: 'reason_offline' };
    if (err && err.name === 'AbortError') return { key: 'reason_place_timeout', params: { s: 8 } };
    if (err && err.status) return { key: 'reason_http', params: { code: err.status } };
    return { key: 'reason_network' };
  }
  function usePlace(p) {
    state.searched = { name: p.name, lat: p.lat, lon: p.lon }; state.place = 'search'; persist();
    applyI18n(); $('#loc').value = 'search';
    $('#place-results').innerHTML = ''; $('#place-q').value = '';
    setPlaceMsg('place_set', { place: p.name });
    fetchForecast();
  }
  var placeSeq = 0;
  function onPlaceSearch(ev) {
    ev.preventDefault();
    var q = $('#place-q').value.trim(), ul = $('#place-results'), msg = $('#place-msg');
    ul.innerHTML = '';
    if (q.length < 2) { $('#place-q').focus(); return; }
    setPlaceMsg('place_searching');
    var mySeq = ++placeSeq;
    P.search(q, state.lang).then(function (list) {
      if (mySeq !== placeSeq) return;
      if (!list.length) { setPlaceMsg('place_none', { q: q }); return; }
      if (list.length === 1) { usePlace(list[0]); return; }
      setPlaceMsg('place_pick');
      list.forEach(function (p) {
        var li = el('li'), b = el('button', { type: 'button', class: 'btn ghost' }, p.name);
        b.addEventListener('click', function () { usePlace(p); });
        li.appendChild(b); ul.appendChild(li);
      });
      ul.querySelector('button').focus();
    }).catch(function (err) {
      if (mySeq !== placeSeq) return;
      var r = placeReason(err), prev = placeName();
      placeMsg = { key: 'place_error', params: { place: prev }, reason: r };
      msg.textContent = placeErrorText();
    });
  }

  function asOf(savedAt) {
    var a = FC.ageParts(Date.now() - savedAt);
    return t(a.key, { n: a.n, h: a.h, m: a.m });
  }
  function reasonText(err) {
    if (!err) return '';
    if (err.rateLimited) return t('reason_429');
    if (err.offline || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) return t('reason_offline');
    if (err.timedOut) return t('reason_timeout', { s: Math.round(F.TIMEOUT_MS / 1000) });
    if (err.status) return t('reason_http', { code: err.status });
    return t('reason_network');
  }
  /** The honest status line for whatever forecast is on screen (re-run every minute so "N min ago" stays true). */
  function renderFcStatus() {
    var s = $('#fc-status');
    if (fcError) { s.textContent = t('fc_nodata', { place: placeName(), reason: reasonText(fcError) }); s.className = 'status status-warn'; return; }
    s.className = 'status';
    if (!fcMeta || fcMeta.source === 'network') { s.textContent = ''; return; }
    var offline = typeof navigator.onLine === 'boolean' && !navigator.onLine;
    if (fcMeta.source === 'fallback') {
      var e = fcMeta.error || {};
      // Offline or a timed-out request gets its own plain message; the saved forecast stays on screen.
      if (offline || e.offline) s.textContent = t('fc_offline', { asof: asOf(fcMeta.savedAt) });
      else if (e.timedOut) s.textContent = t('fc_timeout', { s: Math.round(F.TIMEOUT_MS / 1000), asof: asOf(fcMeta.savedAt) });
      else s.textContent = t('fc_fallback', { reason: reasonText(e), asof: asOf(fcMeta.savedAt) });
      s.className = 'status status-warn';
    }
    else s.textContent = t(offline ? 'fc_offline' : 'fc_cached', { asof: asOf(fcMeta.savedAt) });
  }

  function fetchForecast(force) {
    var c = coords(), seq = ++fcSeq;
    $('#fc-status').textContent = t('loading'); $('#fc-status').className = 'status';
    return FC.getForecast({ lat: c.lat, lon: c.lon, storage: localStorage, now: Date.now(), load: F.load, force: force === true })
      .then(function (r) {
        if (seq !== fcSeq) return;
        forecast = r.data; fcError = null;
        fcMeta = { source: r.source, savedAt: r.savedAt, error: r.error || null }; // reason is worded at render time (EN/ES)
      }, function (err) {
        if (seq !== fcSeq) return;
        forecast = null; fcMeta = null; fcError = err; // never show another place's or a too-old forecast
      })
      .then(function () { if (seq !== fcSeq) return; renderFcStatus(); renderAll(); });
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
      fact(t('place_fact'), placeName()); // the printed plan / screenshot must say where it is for
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
    $('#try-demo').hidden = tr.status === 'ready' || !!demo;
    if (tr.status !== 'ready') rp.textContent = t('risk_none', { days: M.MIN_DAYS });
    else if (!pred) rp.textContent = t('forecast_none');
    else {
      rp.innerHTML = '';
      var b = el('span', { class: 'risk risk-' + risk }, t('risk_' + risk));
      rp.appendChild(b);
      rp.appendChild(document.createTextNode(' · ' + Math.round(pred.p * 100) + '%'));
      if (demo) rp.appendChild(el('span', { class: 'demo-tag' }, t('demo_tag')));
    }
    var src = $('#fc-source');
    src.textContent = forecast && forecast.fetchedAt ? t('source_line', { time: new Date(forecast.fetchedAt).toLocaleString(state.lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) }) : '';
    if (forecast && fcMeta && fcMeta.source !== 'network') src.textContent += ' \u00b7 ' + asOf(fcMeta.savedAt);
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

  /* ---------- form checks (the forms are novalidate, so min/max/step on the inputs are only hints) ---------- */
  // A blank box is fine (null); otherwise a whole number of L/min inside the box's own min..max (50..900).
  function litersOk(input) {
    if (input.validity && input.validity.badInput) return false;
    var v = input.value.trim(); if (v === '') return true;
    var n = Number(v);
    return isFinite(n) && Math.floor(n) === n && n >= Number(input.min) && n <= Number(input.max);
  }
  function setFormErr(which, key, input) {
    formErr[which] = key;
    $(which === 'ci' ? '#ci-err' : '#plan-err').textContent = key ? t(key) : '';
    var ids = which === 'ci' ? ['#ci-pf', '#ci-date'] : ['#p-best'];
    ids.forEach(function (id) { $(id).removeAttribute('aria-invalid'); });
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
  }

  /* ---------- check-in ---------- */
  function showResult(entry) {
    lastResult = entry;
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
    if (($('#ci-date').validity && $('#ci-date').validity.badInput) || ($('#ci-date').value && $('#ci-date').value > TODAY)) return setFormErr('ci', 'err_date_future', $('#ci-date'));
    if (!litersOk($('#ci-pf'))) return setFormErr('ci', 'err_pf', $('#ci-pf'));
    setFormErr('ci', null);
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
      $('#eval').textContent = ev ? t('eval_line', { n: ev.testDays, acc: Math.round(ev.accuracy * 100), base: Math.round(ev.baseline * 100), brier: ev.brier.toFixed(2) }) : t('eval_none');
      var d = dayFor(TOMORROW);
      if (d) {
        var pred = M.predict(tr.model, featuresFor(TOMORROW));
        $('#why').hidden = false;
        $('#why-h').textContent = t('why_h', { band: t('risk_' + M.band(pred.p)).toLowerCase() });
        var ul = $('#why-list'); ul.innerHTML = '';
        pred.contributions.slice(0, 4).forEach(function (c) {
          var v = c.value == null ? '—' : c.key === 'pollenLevel' && d.pollenLevel == null ? t('pollen_logged', { level: t('pollen_' + c.value) }) : fmtFeature(c);
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
      li.appendChild(el('span', { class: 'h-text' }, fmtDate(e.date, { month: 'short', day: 'numeric' }) + (e.percent != null ? ' · ' + e.percent + '%' : '') + (e.aqiO3 != null ? ' · ' + t('ozone') + ' ' + e.aqiO3 : '') + (e.synthetic ? ' · ' + t('hist_demo') : '')));
      if (tr.status === 'ready') {
        var b = el('button', { type: 'button', class: 'btn ghost btn-mini', 'data-date': e.date, 'aria-label': t('explain_btn_label', { date: fmtDate(e.date, { month: 'long', day: 'numeric' }) }) }, t('explain_btn'));
        b.addEventListener('click', function () { explainDate = e.date; renderExplain(tr); $('#explain').scrollIntoView({ block: 'start' }); $('#explain-date').focus(); });
        li.appendChild(b);
      }
      hist.appendChild(li);
    });
    renderExplain(tr);
  }

  function fmtFeature(c) {
    if (c.value == null) return t('explain_missing');
    if (c.key === 'pollenLevel') return t('pollen_' + c.value);
    if (c.key === 'prevBad') return c.value ? '✓' : '✗';
    if (c.key === 'tempMaxF') return Math.round(c.value) + '\u00a0°F';
    if (c.key === 'humidity') return Math.round(c.value) + '%';
    return String(c.value);
  }

  /* ---------- explain a past day ---------- */
  function renderExplain(tr) {
    var box = $('#explain'), out = $('#explain-out'), sel = $('#explain-date');
    var src = trainingEntries();
    if (!tr || tr.status !== 'ready' || !src.length) { box.hidden = true; return; }
    box.hidden = false;
    var dates = src.map(function (e) { return e.date; }).sort().reverse();
    if (!explainDate || dates.indexOf(explainDate) === -1) explainDate = dates[0];
    sel.innerHTML = '';
    dates.forEach(function (d) {
      var e = src.filter(function (x) { return x.date === d; })[0];
      var o = el('option', { value: d }, fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + t('zone_' + e.zone));
      sel.appendChild(o);
    });
    sel.value = explainDate;
    var x = M.explainDay(src, explainDate);
    out.innerHTML = '';
    if (!x || x.status !== 'ready') { out.appendChild(el('p', null, t('explain_none'))); return; }
    var entry = src.filter(function (e) { return e.date === explainDate; })[0];
    var head = el('p', { class: 'ex-head' });
    head.appendChild(el('span', { class: 'zchip z-' + entry.zone }, t('zone_' + entry.zone)));
    head.appendChild(document.createTextNode(' ' + fmtDate(explainDate) + (entry.synthetic ? ' · ' + t('explain_synth') : '')));
    out.appendChild(head);
    out.appendChild(el('p', null, t(x.actual ? 'explain_rough' : 'explain_good')));
    out.appendChild(el('p', { class: 'ex-now' }, t('explain_now', { p: Math.round(x.p * 100), n: src.length })));
    out.appendChild(el('p', { class: 'ex-before' }, x.before ? t('explain_before', { p: Math.round(x.before.p * 100), n: x.before.trainedDays }) : t('explain_before_none')));
    var max = Math.max.apply(null, x.contributions.map(function (c) { return Math.abs(c.contribution); }).concat([0.5]));
    var list = el('ol', { class: 'ex-list' });
    var first = el('li', { class: 'ex-row ex-edge' });
    first.appendChild(el('span', { class: 'ex-lab' }, t('explain_start')));
    first.appendChild(el('span', { class: 'ex-val' }, Math.round(x.baseP * 100) + '%'));
    list.appendChild(first);
    x.contributions.forEach(function (c) {
      var li = el('li', { class: 'ex-row ' + (c.contribution >= 0 ? 'up' : 'down') });
      li.appendChild(el('span', { class: 'ex-lab' }, t('f_' + c.feature) + ': ' + fmtFeature(c)));
      var track = el('span', { class: 'wtrack', 'aria-hidden': 'true' });
      var bar = el('span', { class: 'wbar ' + (c.contribution >= 0 ? 'pos' : 'neg') });
      bar.style.width = (Math.abs(c.contribution) / max * 50) + '%';
      track.appendChild(bar); li.appendChild(track);
      var flat = Math.abs(c.contribution) < 0.005;
      li.appendChild(el('span', { class: 'ex-val' }, (flat ? '– ' : c.contribution >= 0 ? '▲ ' : '▼ ') + t('explain_odds', { x: c.oddsRatio.toFixed(c.oddsRatio < 10 ? 2 : 1) })));
      list.appendChild(li);
    });
    var last = el('li', { class: 'ex-row ex-edge' });
    last.appendChild(el('span', { class: 'ex-lab' }, t('explain_end')));
    last.appendChild(el('span', { class: 'ex-val' }, Math.round(x.p * 100) + '%'));
    list.appendChild(last);
    out.appendChild(list);
    out.appendChild(el('p', { class: 'fine' }, t('explain_note')));
  }

  /* ---------- SYNTHETIC model check: calibration + sensitivity ---------- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (a) { n.setAttribute(a, attrs[a]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function pct(v) { return Math.round(v * 100) + '%'; }

  function chartFrame(w, h, pad, xLab, yLab) {
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'tsvg', role: 'img' });
    s.appendChild(svg('line', { x1: pad.l, y1: h - pad.b, x2: w - pad.r, y2: h - pad.b, class: 'ax' }));
    s.appendChild(svg('line', { x1: pad.l, y1: pad.t, x2: pad.l, y2: h - pad.b, class: 'ax' }));
    s.appendChild(svg('text', { x: (pad.l + w - pad.r) / 2, y: h - 4, 'text-anchor': 'middle', class: 'axl' }, xLab));
    s.appendChild(svg('text', { x: 12, y: (pad.t + h - pad.b) / 2, 'text-anchor': 'middle', class: 'axl', transform: 'rotate(-90 12 ' + (pad.t + h - pad.b) / 2 + ')' }, yLab));
    return s;
  }

  function relChart(rel) {
    var w = 300, h = 260, pad = { l: 44, r: 12, t: 12, b: 40 };
    var X = function (v) { return pad.l + v * (w - pad.l - pad.r); }, Y = function (v) { return h - pad.b - v * (h - pad.t - pad.b); };
    var s = chartFrame(w, h, pad, t('chart_said'), t('chart_obs'));
    [0, 0.5, 1].forEach(function (v) {
      s.appendChild(svg('text', { x: X(v), y: h - pad.b + 14, 'text-anchor': v === 1 ? 'end' : v === 0 ? 'start' : 'middle', class: 'tick' }, pct(v)));
      s.appendChild(svg('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'tick' }, pct(v)));
    });
    s.appendChild(svg('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), class: 'diag' }));
    var pts = rel.bins.filter(function (b) { return b.n > 0; });
    s.appendChild(svg('polyline', { points: pts.map(function (b) { return X(b.meanP) + ',' + Y(b.observed); }).join(' '), class: 'ln model' }));
    var maxN = Math.max.apply(null, pts.map(function (b) { return b.n; }));
    pts.forEach(function (b) { s.appendChild(svg('circle', { cx: X(b.meanP), cy: Y(b.observed), r: 3 + 6 * Math.sqrt(b.n / maxN), class: 'dot' })); });
    return s;
  }

  function sensChart(sens) {
    var w = 300, h = 260, pad = { l: 44, r: 12, t: 12, b: 40 };
    var rows = sens.filter(function (r) { return r.summary; });
    var xs = rows.map(function (r) { return r.days; }), x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var X = function (v) { return pad.l + (v - x0) / (x1 - x0) * (w - pad.l - pad.r); };
    var Y = function (v) { return h - pad.b - (v - 0.4) / 0.5 * (h - pad.t - pad.b); }; // 40%..90%
    var s = chartFrame(w, h, pad, t('chart_days'), t('sens_col_acc'));
    [0.4, 0.6, 0.8].forEach(function (v) { s.appendChild(svg('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'tick' }, pct(v))); });
    rows.forEach(function (r) { s.appendChild(svg('text', { x: X(r.days), y: h - pad.b + 14, 'text-anchor': 'middle', class: 'tick' }, String(r.days))); });
    function line(key, cls) {
      s.appendChild(svg('polyline', { points: rows.map(function (r) { return X(r.days) + ',' + Y(r.summary[key]); }).join(' '), class: 'ln ' + cls }));
    }
    line('oracleAccuracy', 'best'); line('baselineAccuracy', 'base'); line('accuracy', 'model');
    rows.forEach(function (r) { s.appendChild(svg('circle', { cx: X(r.days), cy: Y(r.summary.accuracy), r: 3.5, class: 'dot' })); });
    var lg = [['model', t('legend_model')], ['base', t('legend_base')], ['best', t('legend_best')]];
    lg.forEach(function (l, i) {
      var y = pad.t + 8 + i * 14;
      s.appendChild(svg('line', { x1: w - 150, y1: y, x2: w - 132, y2: y, class: 'ln ' + l[0] }));
      s.appendChild(svg('text', { x: w - 128, y: y + 4, class: 'tick' }, l[1]));
    });
    return s;
  }

  function renderTrust() {
    var st = $('#trust-status');
    var o = V.DEFAULTS;
    $('#trust-intro').textContent = t('trust_intro', { people: o.seeds.length, days: o.seriesDays, test: o.testDays });
    if (!trustResult) {
      st.textContent = t('trust_running');
      var go = function () { if (trustResult) return; trustResult = V.run(); renderTrust(); };
      if (trustWaiting) return;
      var host = $('#trust-status');
      if ('IntersectionObserver' in window && host) {
        trustWaiting = true;
        var io = new IntersectionObserver(function (es) {
          if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); trustWaiting = false; setTimeout(go, 0); }
        }, { rootMargin: '800px 0px' });
        io.observe(host);
        window.addEventListener('beforeprint', function () { go(); });
      } else { setTimeout(go, 0); }
      return;
    }
    st.textContent = '';
    var r = trustResult, rel = r.reliability, cs = r.calibrationSummary;
    $('#rel-cap').textContent = t('rel_cap', { n: r.reliabilityAt, k: cs.n });
    var rc = $('#rel-chart'); rc.innerHTML = ''; rc.appendChild(relChart(rel));
    var rb = $('#rel-table tbody'); rb.innerHTML = '';
    rel.bins.forEach(function (b) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, Math.round(b.lo * 100) + '–' + Math.round(b.hi * 100) + '%'));
      tr.appendChild(el('td', null, b.n ? pct(b.meanP) : '—'));
      tr.appendChild(el('td', null, b.n ? pct(b.observed) : '—'));
      tr.appendChild(el('td', null, String(b.n)));
      rb.appendChild(tr);
    });
    $('#sens-cap').textContent = t('sens_cap', { test: r.testDays, people: r.people });
    var sc = $('#sens-chart'); sc.innerHTML = ''; sc.appendChild(sensChart(r.sensitivity));
    var sb = $('#sens-table tbody'); sb.innerHTML = '';
    var waitedNote = [];
    r.sensitivity.forEach(function (row) {
      if (!row.summary) return;
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, String(row.days) + (row.waited ? '*' : '')));
      tr.appendChild(el('td', null, pct(row.summary.accuracy)));
      tr.appendChild(el('td', null, pct(row.summary.baselineAccuracy)));
      tr.appendChild(el('td', null, row.summary.brier.toFixed(3)));
      sb.appendChild(tr);
      if (row.waited) waitedNote.push('* ' + row.days + ': ' + t('sens_waited', { w: row.waited, people: r.people }));
    });
    $('#sens-cap').textContent += waitedNote.length ? ' ' + waitedNote.join(' ') : '';
    $('#trust-brier').textContent = t('trust_brier', { n: r.reliabilityAt, b: cs.brier.toFixed(3), c: cs.brierClimatology.toFixed(3), o: cs.brierOracle.toFixed(3),
      ece: (rel.ece * 100).toFixed(1), mp: Math.round(rel.meanP * 100), ob: Math.round(rel.observed * 100) });
  }

  /** Tabs row: mark it when more tabs sit off the right edge (CSS fades that edge). */
  function tabCue() {
    var r = $('.tabs-row'); if (!r) return;
    r.classList.toggle('more', r.scrollLeft + r.clientWidth < r.scrollWidth - 2);
  }
  function renderAll() { applyI18n(); tabCue(); renderThresholds(); renderPlanCard(); renderStrip(); renderInsights(); renderTrust(); }

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
    $('#ics-msg').textContent = t('cal_done');
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
  var lastShareText = null;
  function refreshShareText() {
    // After a language switch, re-write an open share note in the new language unless the user has edited it.
    var box = $('#share-box'), ta = $('#share-text');
    if (box && !box.hidden && ta.value === lastShareText) { lastShareText = ta.value = shareText(); $('#share-msg').textContent = ''; }
  }
  function onShare() {
    var text = shareText(); lastShareText = text;
    $('#share-box').hidden = false; $('#share-text').value = text; $('#share-msg').textContent = '';
    if (navigator.share) {
      navigator.share({ title: 'BreatheEasy', text: text }).then(function () { $('#share-msg').textContent = t('share_done'); }, function () { /* cancelled: text stays on screen */ });
    } else copyShare();
  }

  /* ---------- wire up ---------- */
  function init() {
    buildChecks(); applyI18n(); renderPlanForm();
    $('.tabs-row').addEventListener('scroll', tabCue, { passive: true }); window.addEventListener('resize', tabCue); tabCue();
    $('#loc').value = state.place;
    $('#ci-date').value = TODAY; $('#ci-date').max = TODAY;
    $('#lang').addEventListener('change', function () { state.lang = this.value; persist(); renderFcStatus(); renderAll(); refreshShareText(); });
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
    $('#refresh').addEventListener('click', function () { fetchForecast(true); });
    $('#p-best').addEventListener('input', renderThresholds);
    $('#plan-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      planSaved = false; $('#plan-msg').textContent = '';
      if (!litersOk($('#p-best'))) return setFormErr('plan', 'err_best', $('#p-best'));
      setFormErr('plan', null);
      var best = Number($('#p-best').value);
      state.plan = {
        personalBest: best > 0 ? best : null,
        green: $('#p-green').value.trim(), yellow: $('#p-yellow').value.trim(), red: $('#p-red').value.trim(),
        beforeExercise: $('#p-ex').value.trim(), doctorPhone: $('#p-phone').value.trim(),
        triggers: $$('input[name="trig"]:checked').map(function (c) { return c.value; })
      };
      persist(); planSaved = true; $('#plan-msg').textContent = t('plan_saved'); renderAll();
    });
    $('#ci-form').addEventListener('submit', onCheckin);
    $('#demo-toggle').addEventListener('click', function () {
      if (demo) { demo = null; localStorage.removeItem(DEMO_KEY); }
      else { demo = DEMO.generate(TODAY, 75, 400, 42); save(DEMO_KEY, demo); }
      renderInsights(); renderPlanCard();
    });
    $('#try-demo').addEventListener('click', function () {
      demo = DEMO.generate(TODAY, 75, 400, 42); save(DEMO_KEY, demo);
      renderInsights(); renderPlanCard();
      $('#pc-risk').setAttribute('tabindex', '-1'); $('#pc-risk').focus();
    });
    $('#place-form').addEventListener('submit', onPlaceSearch);
    $('#explain-date').addEventListener('change', function () { explainDate = this.value; renderExplain(trained()); });
    $('#ics').addEventListener('click', onIcs);
    $('#share').addEventListener('click', onShare);
    $('#share-copy').addEventListener('click', copyShare);
    $('#print').addEventListener('click', function () { window.print(); });
    $('#export').addEventListener('click', function () {
      download('breatheeasy-data.json', 'application/json', JSON.stringify({ exportedAt: new Date().toISOString(), plan: state.plan, entries: state.entries }, null, 2));
    });
    $('#wipe').addEventListener('click', function () {
      if (!window.confirm(t('wipe_confirm'))) return;
      [KEY, DEMO_KEY, FC_KEY].forEach(function (k) { localStorage.removeItem(k); }); FC.clear(localStorage);
      state = { lang: state.lang, place: 'sugarland', custom: null, searched: null, plan: { triggers: [] }, entries: [] }; demo = null;
      persist(); renderPlanForm(); $('#ci-result').hidden = true; formErr = { ci: null, plan: null }; planSaved = false; wiped = true; $('#data-msg').textContent = t('wiped'); renderAll(); fetchForecast();
    });
    if (qs.get('demo') === '1' && !demo) { demo = DEMO.generate(TODAY, 75, 400, 42); save(DEMO_KEY, demo); }
    renderAll();
    fetchForecast();
    // Installable + offline: only over http(s) (service workers cannot run from file://).
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* app still works online */ });
    }
    window.addEventListener('online', function () { fetchForecast(true); });
    setInterval(renderFcStatus, 60000); // keep "as of N min ago" honest
  }
  init();
})();
