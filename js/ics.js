/* BreatheEasy: tiny RFC 5545 calendar export (pure function). */
(function (root) {
  'use strict';
  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  // UTF-8 length of one code point.
  function octets(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  // Lines longer than 75 octets must be folded (RFC 5545 §3.1): counted in UTF-8 bytes (Spanish accents are
  // 2 bytes, emoji 4), never splitting a character; each continuation line starts with one space.
  function fold(line) {
    var out = [], cur = '', n = 0, max = 75;
    Array.from(line).forEach(function (ch) {
      var k = octets(ch);
      if (n + k > max) { out.push(cur); cur = ' '; n = 1; }
      cur += ch; n += k;
    });
    out.push(cur);
    return out.join('\r\n');
  }
  /** All-day event on `date` (YYYY-MM-DD). `now` lets tests pin DTSTAMP. */
  function allDayEvent(date, summary, description, now) {
    var d = date.replace(/-/g, '');
    var next = new Date(date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    var d2 = next.toISOString().slice(0, 10).replace(/-/g, '');
    var stamp = (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BreatheEasy//Asthma air plan//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:breatheeasy-' + d + '@breatheeasy.local',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + d,
      'DTEND;VALUE=DATE:' + d2,
      'SUMMARY:' + esc(summary),
      'DESCRIPTION:' + esc(description),
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  var api = { allDayEvent: allDayEvent, esc: esc, fold: fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BE_ICS = api;
})(this);
