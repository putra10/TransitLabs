import { buildGraph, solve } from './engine.mjs';
import { STATIONS, GEO, GLABEL, LABEL, LINES, ROUTE_LINE, stopsBetween, annotateVia } from './lines.mjs';
import { initLang } from './site.mjs';

const MODE_LABEL = { krl: 'KRL', mrt: 'MRT', lrt: 'LRT', transjakarta: 'TJ', walk: 'walk' };

// Dynamic strings in both languages; static copy lives in index.html as lang="" spans.
const STR = {
  en: { walk: 'walk', via: 'via', direct: 'direct', min: 'min', xfer: 'xfer', of: (n, k) => `${n} of k = ${k}`,
    transfers: n => `${n} transfer${n === 1 ? '' : 's'}`, unmeasured: '(TJ hops unmeasured)', rank: n => `rank #${n}`,
    cheapest: 'cheapest', fastest: 'fastest', pareto: 'pareto',
    noroute: 'No route', noroute_why: why => `Blok M is unreachable with ${why}. Relax one constraint.`,
    closedN: n => `${n} station${n > 1 ? 's' : ''} closed`, mustN: list => `must pass ${list.join(' and ')}`, onlyModes: m => `only ${m}`,
    tip_closed: 'closed · line cut here · click to reopen', tip_must: 'must pass · shift-click to release',
    tip_on: (n, k) => `on ${n} of ${k} journeys`, tip_spof: ' · single point of failure', tip_none: 'on no current journey',
    gtip_closed: 'closed', gtip_must: 'must pass', gtip_on: (n, k) => `${n}/${k} journeys`,
    w_speed: 'Speed first', w_budget: 'Budget first', w_balanced: 'Balanced', add_station: 'add a station…', remove: 'remove', surveyed: 'surveyed fare' },
  id: { walk: 'jalan kaki', via: 'lewat', direct: 'langsung', min: 'mnt', xfer: 'transit', of: (n, k) => `${n} dari k = ${k}`,
    transfers: n => `${n} kali transit`, unmeasured: '(jarak TJ tidak terukur)', rank: n => `peringkat #${n}`,
    cheapest: 'termurah', fastest: 'tercepat', pareto: 'pareto',
    noroute: 'Tidak ada rute', noroute_why: why => `Blok M tidak terjangkau dengan ${why}. Longgarkan satu batasan.`,
    closedN: n => `${n} stasiun ditutup`, mustN: list => `wajib lewat ${list.join(' dan ')}`, onlyModes: m => `hanya ${m}`,
    tip_closed: 'ditutup · jalur terputus di sini · klik untuk membuka', tip_must: 'wajib lewat · shift-klik untuk melepas',
    tip_on: (n, k) => `dilewati ${n} dari ${k} perjalanan`, tip_spof: ' · titik kegagalan tunggal', tip_none: 'tidak dilewati perjalanan mana pun',
    gtip_closed: 'ditutup', gtip_must: 'wajib lewat', gtip_on: (n, k) => `${n}/${k} perjalanan`,
    w_speed: 'Utamakan cepat', w_budget: 'Utamakan murah', w_balanced: 'Seimbang', add_station: 'tambah stasiun…', remove: 'hapus', surveyed: 'tarif survei' },
};
let lang = 'en';
const T = () => STR[lang];
const CSS_MODE = m => (m === 'transjakarta' ? 'tj' : m);
const GAP = 4.5;                       // spacing between parallel lines

const $ = s => document.querySelector(s);
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const rp = n => 'Rp ' + n.toLocaleString('id-ID');

const [data, GEOM] = await Promise.all([fetch('data/optg.json').then(r => r.json()), fetch('data/geometry.json').then(r => r.ok ? r.json() : {})]);
annotateVia(data);
const g = buildGraph(data);
const { start, end } = data.meta;
const st = n => g.station.get(n) ?? n;
const pos = name => { const p = STATIONS[name]; if (!p) throw new Error(`no layout for ${name}`); return p; };

// ── Octilinear geometry ───────────────────────────────────────────────────────
// A stop entry is a station name ("~name" = pass-through) or an [x, y] bend.
const ptOf = s => Array.isArray(s) ? s : pos(s.replace(/^~/, ''));
const nameOf = s => Array.isArray(s) ? null : s.replace(/^~/, '');
const key = (p, q) => [p, q].map(v => v.join(',')).sort().join('|');

// Straight-then-diagonal elbow, computed from the canonical (smaller) endpoint
// so two lines sharing a pair bend identically whichever way they run it.
function elbow(p, q) {
  const flip = q[0] < p[0] || (q[0] === p[0] && q[1] < p[1]);
  if (flip) return elbow(q, p).reverse();
  const dx = q[0] - p[0], dy = q[1] - p[1], ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax === 0 || ay === 0 || ax === ay) return [p, q];
  const m = ax > ay ? [p[0] + Math.sign(dx) * (ax - ay), p[1]] : [p[0], p[1] + Math.sign(dy) * (ay - ax)];
  return [p, m, q];
}

// Offset a 2–3 point polyline sideways by d (miter at the bend).
function offset(pts, d) {
  if (!d) return pts;
  const n = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return [-dy / L, dx / L]; };
  return pts.map((v, i) => {
    let nx, ny;
    if (i === 0) [nx, ny] = n(pts[0], pts[1]);
    else if (i === pts.length - 1) [nx, ny] = n(pts[i - 1], pts[i]);
    else {
      const [a, b] = n(pts[i - 1], pts[i]), [c, e] = n(pts[i], pts[i + 1]);
      const k = 1 + (a * c + b * e); nx = (a + c) / k; ny = (b + e) / k;
    }
    return [v[0] + nx * d, v[1] + ny * d];
  });
}
const toD = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

// Which lines share each consecutive pair → their slot for the parallel offset.
const shared = new Map();
for (const line of LINES) {
  for (let i = 1; i < line.stops.length; i++) {
    const k = key(ptOf(line.stops[i - 1]), ptOf(line.stops[i]));
    if (!shared.has(k)) shared.set(k, []);
    shared.get(k).push(line.id);
  }
}
const slot = (k, id) => { const ids = shared.get(k); return (ids.indexOf(id) - (ids.length - 1) / 2) * GAP; };

// Polyline of `line` between two of its stations (either direction), no offset.
function slice(line, a, b) {
  const names = line.stops.map(nameOf);
  let i = names.indexOf(a), j = names.indexOf(b);
  if (i < 0 || j < 0) return null;
  const rev = i > j;
  if (rev) [i, j] = [j, i];
  const out = [];
  for (let k = i; k < j; k++) {
    const seg = elbow(ptOf(line.stops[k]), ptOf(line.stops[k + 1]));
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  return rev ? out.reverse() : out;
}

const polyLen = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
// Stations the line passes strictly between a and b (real stops only), with
// their fraction of the way along `pathOf(a, x)` vs `pathOf(a, b)`.
function viaStations(line, a, b, pathOf) {
  const total = polyLen(pathOf(a, b) || []) || 1, out = [];
  for (const id of stopsBetween(line, a, b)) {
    const part = pathOf(a, id);
    if (part) out.push({ id, f: polyLen(part) / total });
  }
  return out;
}

// ── Static network ────────────────────────────────────────────────────────────
const map = $('#map');
const gWalk = svgEl('g'), gLines = svgEl('g'), gRoute = svgEl('g'), gStations = svgEl('g');
// Keep walking transfers above service lines so shared interchange links stay
// visibly dashed, including Semanggi to Bendungan Hilir and CSW to Kejaksaan.
map.append(gLines, gWalk, gRoute, gStations);

// Walk links between distinct stations.
const walked = new Set();
for (const e of data.edges) {
  const a = st(e.from), b = st(e.to);
  if (e.mode !== 'walk' || a === b) continue;
  const k = key(pos(a), pos(b));
  if (walked.has(k)) continue;
  walked.add(k);
  const d = toD(elbow(pos(a), pos(b)));
  gWalk.append(
    svgEl('path', { d, class: 'walklink-casing' }),
    svgEl('path', { d, class: 'walklink' })
  );
}

const lineMode = new Map(LINES.map(l => [l.id, data.edges.find(e => l.routes.includes(e.route))?.mode]));
const lineEls = new Map();   // line id -> [path]
for (const line of LINES) {
  const els = [];
  for (let i = 1; i < line.stops.length; i++) {
    const p = ptOf(line.stops[i - 1]), q = ptOf(line.stops[i]);
    const pts = elbow(p, q), k = key(p, q);
    // Offset sign follows the canonical direction so shared pairs stack consistently.
    const d = slot(k, line.id) * (pts[0] === p ? 1 : -1);
    const el = svgEl('path', { d: toD(offset(pts, d)), class: 'line' + (line.rail ? ' rail' : ''), stroke: line.color });
    el.dataset.a = nameOf(line.stops[i - 1]) || ''; el.dataset.b = nameOf(line.stops[i]) || '';
    gLines.append(el); els.push(el);
  }
  lineEls.set(line.id, els);
}

// Stations. Interchange = served by more than one line.
const linesAt = new Map();
for (const line of LINES) for (const s of line.stops) {
  const n = nameOf(s); if (!n || s.startsWith('~')) continue;
  linesAt.set(n, (linesAt.get(n) || 0) + 1);
}
const stationEls = new Map();
for (const [id, [x, y]] of Object.entries(STATIONS)) {
  const terminal = id === start || id === end;
  const cls = 'station' + (terminal ? ' terminal' : (linesAt.get(id) || 0) > 1 ? ' xfer' : '');
  const grp = svgEl('g', { class: cls, transform: `translate(${x},${y})` });
  const [dx, dy, anchor] = LABEL[id] || [10, 4, 'start'];
  grp.append(svgEl('circle', { class: 'pulse', r: 8 }), svgEl('circle', { class: 'dot', r: 5 }), svgEl('text', { x: dx, y: dy, 'text-anchor': anchor }));
  grp.querySelector('text').textContent = id;
  grp.dataset.id = id;
  gStations.append(grp); stationEls.set(id, grp);
}

// ── State ─────────────────────────────────────────────────────────────────────
const closed = new Set(), must = new Set();
const modes = new Set(['krl', 'mrt', 'lrt', 'transjakarta']);
let wFare = 0.5, result, selected = 0;

function recompute() {
  result = solve(g, data, { closed, modes, must: [...must], wFare });
  selected = 0;
  for (const [lid, els] of lineEls) for (const el of els) el.classList.toggle('dead', !modes.has(lineMode.get(lid)) || closed.has(el.dataset.a) || closed.has(el.dataset.b));
  if (geo) for (const [lid, pl] of geo.lines) pl.setStyle({ opacity: modes.has(lineMode.get(lid)) ? .9 : .15 });
  for (const [id, el] of stationEls) { el.classList.toggle('closed', closed.has(id)); el.classList.toggle('must', must.has(id)); }
  renderMust();
  if (geo) for (const id of geo.markers.keys()) geoStyle(id);
  renderList(); showPath(true);
}

function renderList() {
  const { paths } = result;
  $('#count').textContent = paths.length ? T().of(paths.length, data.meta.k) : '';
  $('#list').replaceChildren(...paths.map((p, i) => {
    const li = document.createElement('li');
    const via = [], chips = [];
    for (const e of p.path) if (e.mode !== 'walk' && e.route !== chips.at(-1)?.route) { if (chips.length) via.push(st(e.from)); chips.push(e); }
    li.innerHTML = `<span class="n">${i + 1}</span>
      <span><span class="modes">${chips.map(e => `<i style="--c:${ROUTE_LINE.get(e.route)?.color ?? '#888'}" title="${e.route}">${ROUTE_LINE.get(e.route)?.id ?? e.route}</i>`).join('')}</span>
        <span class="via">${via.length ? T().via + ' ' + via.join(' · ') : T().direct}</span>
        ${p.tags.map(t => `<span class="tag ${t}">${T()[t]}</span>`).join('')}</span>
      <span class="stat">${rp(p.fare)}<small>${p.time} ${T().min} · ${p.transfers} ${T().xfer}</small></span>`;
    li.addEventListener('click', () => { selected = i; showPath(true); });
    return li;
  }));
}

function showPath(play) {
  const p = result.paths[selected];
  [...$('#list').children].forEach((li, i) => i === selected ? li.setAttribute('aria-current', 'true') : li.removeAttribute('aria-current'));
  gRoute.replaceChildren();
  map.classList.remove('playing');
  map.classList.toggle('has-route', !!p);
  for (const el of stationEls.values()) { el.classList.remove('on', 'via'); el.style.removeProperty('--delay'); }

  if (!p) {
    const why = [closed.size && T().closedN(closed.size), must.size && T().mustN([...must]), modes.size < 4 && T().onlyModes([...modes].map(m => MODE_LABEL[m]).join(', '))].filter(Boolean).join(', ');
    $('#best').innerHTML = `<div class="big none">${T().noroute}</div><div>${T().noroute_why(why)}</div>`;
    return;
  }
  const steps = p.path.map((e, i) => [e, p.legFares[i]]).filter(([e]) => e.mode !== 'walk' || st(e.from) !== st(e.to)).map(([e, legFare]) => {
    const line = ROUTE_LINE.get(e.route);
    const label = e.mode === 'walk' ? T().walk : MODE_LABEL[e.mode] + (line?.id === MODE_LABEL[e.mode] ? '' : ' ' + (line?.id ?? e.route));
    return `<li><i style="--c:${line?.color ?? '#6b7280'}"></i>${label} · ${st(e.from)} → ${st(e.to)} <span>· ${e.time} ${T().min}${legFare ? ' · ' + rp(legFare) : ''}</span></li>`;
  });
  $('#best').innerHTML = `<div class="big">${rp(p.fare)} · ${p.time} min</div>
    <div>${T().transfers(p.transfers)} · ${(p.dist / 1000).toFixed(1)} km${p.dist ? '' : ' ' + T().unmeasured} · ${T().rank(selected + 1)}${p.tags.map(t => `<span class="tag ${t}">${T()[t]}</span>`).join('')}${p.surveyed ? `<span class="tag surveyed" title="${p.surveyed}">${T().surveyed}</span>` : ''}</div>
    <ul class="steps">${steps.join('')}</ul>`;

  // Route overlay: each hop drawn along its line's polyline, animated in sequence.
  const segs = [];
  for (const e of p.path) {
    const a = st(e.from), b = st(e.to);
    if (a === b) continue;
    const line = ROUTE_LINE.get(e.route);
    const pts = (line && slice(line, a, b)) || elbow(pos(a), pos(b));
    const d = toD(pts);
    const el = svgEl('g', { class: `route ${CSS_MODE(e.mode)}`, style: `--c:${line?.color ?? 'var(--walk)'}` });
    el.append(svgEl('path', { d, class: 'casing' }), svgEl('path', { d, class: 'ink' }));
    gRoute.append(el);
    segs.push({ el, a, b, line, len: el.lastChild.getTotalLength() });
  }
  const total = segs.reduce((s, x) => s + x.len, 0) || 1, DUR = 2.6;
  let t = 0;
  stationEls.get(st(start)).classList.add('on');
  stationEls.get(st(start)).style.setProperty('--delay', '0s');
  for (const s of segs) {
    const dur = DUR * s.len / total;
    s.el.style.setProperty('--len', s.len.toFixed(1)); s.el.style.setProperty('--dur', `${dur.toFixed(2)}s`); s.el.style.setProperty('--delay', `${t.toFixed(2)}s`);
    // Trains and buses pass stations the graph edge skips: let them blink by.
    if (s.line) for (const v of viaStations(s.line, s.a, s.b, (x, y) => slice(s.line, x, y))) {
      const el = stationEls.get(v.id); if (el.classList.contains('on')) continue;
      el.classList.add('via'); el.style.setProperty('--delay', `${(t + dur * v.f).toFixed(2)}s`);
    }
    t += dur;
    const el = stationEls.get(s.b); el.classList.add('on'); el.classList.remove('via'); el.style.setProperty('--delay', `${t.toFixed(2)}s`);
  }
  if (geo) geoRoute(p);
  if (play) requestAnimationFrame(() => { map.classList.add('playing'); geo?.el.classList.add('playing'); });
}

// ── Map view: Leaflet on OpenStreetMap tiles, same state ─────────────────────
let geo = null;
const RAIL = new Set(['Bogor', 'Cikarang', 'MRT', 'LRT']);
// Stops a line's traced geometry runs through (rail skips "~" halte, which sit off the track).
const GSTOPS = line => line.stops.filter(x => !Array.isArray(x) && !(RAIL.has(line.id) && x.startsWith('~'))).map(nameOf);
// Path along the line between two of its stops (traced where cached), or null if not both on the line.
function geoPath(line, a, b) {
  const names = GSTOPS(line), cache = GEOM[line.id] || {};
  let i = names.indexOf(a), j = names.indexOf(b);
  if (i < 0 || j < 0) return null;
  const rev = i > j; if (rev) [i, j] = [j, i];
  const out = [];
  for (let k = i; k < j; k++) {
    const x = names[k], y = names[k + 1];
    // An untraced hop falls back to a straight segment on its own, not the whole line.
    const seg = cache[`${x}|${y}`] || (cache[`${y}|${x}`] ? [...cache[`${y}|${x}`]].reverse() : [GEO[x], GEO[y]]);
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  return rev ? out.reverse() : out;
}
const geoLine = line => { const n = GSTOPS(line); return geoPath(line, n[0], n.at(-1)) || n.map(x => GEO[x]); };
function geoStyle(id) {
  const mk = geo.markers.get(id), terminal = id === start || id === end, on = stationEls.get(id).classList.contains('on');
  mk.setStyle(closed.has(id)
    ? { color: '#f43f5e', dashArray: '2 2', fillColor: '#fee2e2', weight: 2 }
    : must.has(id) ? { color: '#d97706', dashArray: null, fillColor: '#fde68a', weight: 3.5 }
    : { color: terminal ? '#fff' : '#1f2937', dashArray: null, fillColor: terminal ? '#e11d48' : '#fff', weight: on ? 3 : 2 });
  mk._path.classList.remove('gvia', 'gon'); mk._path.style.removeProperty('--delay');
}
function initGeo() {
  const el = $('#geo');
  const m = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 });
  // Stations must sit above the route highlight or their clicks get swallowed.
  m.createPane('routes').style.zIndex = 450;
  m.createPane('stations').style.zIndex = 460;
  m.createPane('labels').style.zIndex = 470;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
  const lines = L.layerGroup().addTo(m), routes = L.layerGroup().addTo(m), stations = L.layerGroup().addTo(m);
  const lineLayers = new Map(LINES.map(line => [line.id, L.polyline(geoLine(line), { color: line.color, weight: line.rail ? 5 : 3.5, opacity: .9, className: 'gline' }).addTo(lines)]));
  const markers = new Map();
  for (const [id, ll] of Object.entries(GEO)) {
    const terminal = id === start || id === end, xfer = stationEls.get(id).classList.contains('xfer');
    const mk = L.circleMarker(ll, { pane: 'stations', radius: terminal ? 8 : xfer ? 6.5 : 5, fillOpacity: 1, className: terminal ? '' : 'gstation' }).addTo(stations);
    const dir = GLABEL[id] || 'right', off = { right: [8, 0], left: [-8, 0], top: [0, -8], bottom: [0, 8] }[dir];
    mk.bindTooltip(id, { pane: 'labels', permanent: true, direction: dir, offset: off, className: 'glabel ' + (terminal ? 'l0' : xfer ? 'l1' : 'l2') });
    if (!terminal) mk.on('click', ev => { ev.originalEvent.shiftKey ? toggleMust(id) : toggleClosed(id); });
    mk.on('mouseover', () => { const n = result.criticality.get(id) || 0, k = result.paths.length; mk.setTooltipContent(`${id} · ${closed.has(id) ? T().gtip_closed : must.has(id) ? T().gtip_must : T().gtip_on(n, k)}`); });
    mk.on('mouseout', () => mk.setTooltipContent(id));
    markers.set(id, mk);
  }
  const tier = () => { const z = m.getZoom(); el.classList.toggle('z1', z < 13); el.classList.toggle('z2', z < 14); };
  m.on('zoomend', tier);
  // Leaflet re-projects paths on zoom, so a dash length measured earlier would leave gaps.
  m.on('zoomstart', () => el.classList.remove('playing'));
  geo = { el, m, routes, markers, lines: lineLayers };
  for (const [lid, pl] of lineLayers) pl.setStyle({ opacity: modes.has(lineMode.get(lid)) ? .9 : .15 });
  m.invalidateSize();
  m.fitBounds(L.latLngBounds(Object.values(GEO)), { padding: [16, 16] });
  tier();
  for (const id of markers.keys()) geoStyle(id);
}
function geoRoute(p) {
  geo.routes.clearLayers();
  geo.el.classList.remove('playing');
  geo.el.classList.toggle('has-route', !!p);
  for (const id of geo.markers.keys()) geoStyle(id);
  if (!p) return;
  // Same hop sequence as the schematic; each hop follows its traced geometry.
  const hops = [];
  for (const e of p.path) {
    const a = st(e.from), b = st(e.to);
    if (a === b) continue;
    const line = ROUTE_LINE.get(e.route);
    const pts = (line && geoPath(line, a, b)) || [GEO[a], GEO[b]];
    const walk = e.mode === 'walk';
    const casing = L.polyline(pts, { pane: 'routes', color: '#fff', weight: walk ? 9 : 14, className: 'groute gcasing' + (walk ? ' gwalk' : '') }).addTo(geo.routes);
    const ink = L.polyline(pts, { pane: 'routes', color: walk ? '#111827' : (line?.color ?? '#6b7280'), weight: walk ? 3 : 7, dashArray: walk ? '4 5' : null, className: 'groute' + (walk ? ' gwalk' : '') }).addTo(geo.routes);
    hops.push({ a, b, line, els: [casing._path, ink._path], len: ink._path.getTotalLength() });
  }
  const total = hops.reduce((s, h) => s + h.len, 0) || 1, DUR = 2.6;
  let t = 0;
  const mark = (id, cls, delay) => { const el = geo.markers.get(id)._path; el.classList.add(cls); el.style.setProperty('--delay', `${delay.toFixed(2)}s`); };
  mark(st(start), 'gon', 0);
  for (const h of hops) {
    const dur = DUR * h.len / total;
    for (const el of h.els) { el.style.setProperty('--len', h.len.toFixed(1)); el.style.setProperty('--dur', `${dur.toFixed(2)}s`); el.style.setProperty('--delay', `${t.toFixed(2)}s`); }
    if (h.line) for (const v of viaStations(h.line, h.a, h.b, (x, y) => geoPath(h.line, x, y))) {
      if (!geo.markers.get(v.id)._path.classList.contains('gon')) mark(v.id, 'gvia', t + dur * v.f);
    }
    t += dur;
    geo.markers.get(h.b)._path.classList.remove('gvia'); mark(h.b, 'gon', t);
  }
  // Once drawn, show the plain full-length line (dash arrays would break on the next zoom).
  clearTimeout(geo.timer);
  geo.timer = setTimeout(() => geo.el.classList.remove('playing'), (t + 0.6) * 1000);
}
function setView(which) {
  const isMap = which === 'map';
  $('#v-schematic').setAttribute('aria-pressed', String(!isMap));
  $('#v-map').setAttribute('aria-pressed', String(isMap));
  map.style.display = isMap ? 'none' : ''; $('#geo').hidden = !isMap;
  if (isMap) {
    if (!geo) initGeo(); else geo.m.invalidateSize();
  }
  showPath(true);   // re-measure path lengths in whichever view is visible
}

// ── Events ────────────────────────────────────────────────────────────────────
const tip = $('#tip');
function toggle(set, id) { set.has(id) ? set.delete(id) : set.add(id); }
function toggleClosed(id) { toggle(closed, id); must.delete(id); recompute(); }
function toggleMust(id) { toggle(must, id); closed.delete(id); recompute(); }
gStations.addEventListener('click', ev => {
  const grp = ev.target.closest('.station');
  if (!grp || grp.classList.contains('terminal')) return;
  tip.hidden = true;
  ev.shiftKey ? toggleMust(grp.dataset.id) : toggleClosed(grp.dataset.id);
});
// Must-pass picker: a select that adds, chips that remove.
const mustSel = $('#mustsel');
for (const id of Object.keys(STATIONS).filter(x => x !== start && x !== end).sort()) mustSel.append(new Option(id, id));
mustSel.options[0].textContent = T().add_station;
mustSel.addEventListener('change', () => { if (mustSel.value) toggleMust(mustSel.value); mustSel.value = ''; });
function renderMust() {
  $('#mustchips').replaceChildren(...[...must].map(id => { const b = document.createElement('button'); b.type = 'button'; b.textContent = id; b.title = T().remove; b.addEventListener('click', () => toggleMust(id)); return b; }));
}
for (const cb of document.querySelectorAll('.modes input')) cb.addEventListener('change', () => { cb.checked ? modes.add(cb.dataset.mode) : modes.delete(cb.dataset.mode); recompute(); });
gStations.addEventListener('mousemove', ev => {
  const grp = ev.target.closest('.station');
  if (!grp) { tip.hidden = true; return; }
  const id = grp.dataset.id, n = result.criticality.get(id) || 0, k = result.paths.length;
  const lines = LINES.filter(l => l.stops.includes(id)).map(l => `<i style="--c:${l.color}">${l.id}</i>`).join('');
  const state = closed.has(id) ? T().tip_closed : must.has(id) ? T().tip_must : n ? T().tip_on(n, k) + (n === k && k ? T().tip_spof : '') : T().tip_none;
  tip.innerHTML = `<b>${id}</b><span class="lines">${lines}</span>${state}`;
  const r = $('.map').getBoundingClientRect();
  tip.style.left = `${ev.clientX - r.left}px`; tip.style.top = `${ev.clientY - r.top}px`;
  tip.hidden = false;
});
gStations.addEventListener('mouseleave', () => { tip.hidden = true; });

function readWeight() {
  wFare = +$('#w').value;
  $('#wout').value = wFare.toFixed(2);
  $('#wlabel').textContent = wFare < 0.35 ? T().w_speed : wFare > 0.65 ? T().w_budget : T().w_balanced;
}
$('#w').addEventListener('input', () => { readWeight(); recompute(); });
$('#play').addEventListener('click', () => showPath(true));
$('#v-schematic').addEventListener('click', () => setView('schematic'));
$('#v-map').addEventListener('click', () => setView('map'));
$('#reset').addEventListener('click', () => {
  closed.clear(); must.clear();
  for (const cb of document.querySelectorAll('.modes input')) { cb.checked = true; modes.add(cb.dataset.mode); }
  recompute();
});

// Presets from the "break the network" strip.
for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => {
  const [kind, arg] = b.dataset.preset.split(':');
  closed.clear(); must.clear();
  for (const cb of document.querySelectorAll('.modes input')) { cb.checked = true; modes.add(cb.dataset.mode); }
  if (kind === 'close') closed.add(arg);
  if (kind === 'must') must.add(arg);
  if (kind === 'modes') for (const cb of document.querySelectorAll('.modes input')) { cb.checked = cb.dataset.mode === arg; if (!cb.checked) modes.delete(cb.dataset.mode); }
  recompute();
  document.querySelector('#lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Language: static copy toggles via CSS; dynamic copy re-renders.
initLang(l => {
  lang = l;
  mustSel.options[0].textContent = T().add_station;
  readWeight();
  if (result) { renderList(); showPath(false); }
});
recompute();
window.transitlab = { get geo() { return geo; }, get result() { return result; }, closed };
