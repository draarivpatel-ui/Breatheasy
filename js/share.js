/* BreatheEasy: plain-text note for a coach, school nurse or caregiver (pure function).
   It only re-uses lines the app already shows (EPA/NHLBI guidance + the user's own plan text). */
(function (root) {
  'use strict';
  /** o = { heading, air, items: [string], footer: [string] } -> multi-line text */
  function note(o) {
    var out = [String(o.heading || '')];
    if (o.air) out.push(String(o.air));
    (o.items || []).forEach(function (s) { if (s) out.push('\u2022 ' + s); });
    out.push('');
    (o.footer || []).forEach(function (s) { if (s) out.push(String(s)); });
    return out.join('\n');
  }
  var api = { note: note };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_Share = api;
})(this);
