import { buildGraph, solve } from './engine.mjs';
import { STATIONS, GEO, LABEL, LINES, ROUTE_LINE } from './lines.mjs';

const MODE_LABEL = { krl: 'KRL', mrt: 'MRT', lrt: 'LRT', transjakarta: 'TJ', walk: 'walk' };
const CSS_MODE = m => (m === 'transjakarta' ? 'tj' : m);
const GAP = 4.5;                       // spacing between parallel lines

const $ = s => document.querySelector(s);
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const rp = n => 'Rp ' + n.toLocaleString('id-ID');

const data = await fetch('data/optg.json').then(r => r.json());
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

// ── Static network ────────────────────────────────────────────────────────────
const map = $('#map');
const gWalk = svgEl('g'), gLines = svgEl('g'), gRoute = svgEl('g'), gStations = svgEl('g');
map.append(gWalk, gLines, gRoute, gStations);

// Walk links between distinct stations (dashed, under everything).
const walked = new Set();
for (const e of data.edges) {
  const a = st(e.from), b = st(e.to);
  if (e.mode !== 'walk' || a === b) continue;
  const k = key(pos(a), pos(b));
  if (walked.has(k) || shared.has(k)) continue;
  walked.add(k);
  gWalk.append(svgEl('path', { d: toD(elbow(pos(a), pos(b))), class: 'walklink' }));
}

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
const closed = new Set();
let wFare = 0.5, result, selected = 0;

function recompute() {
  result = solve(g, data, { closed, wFare });
  selected = 0;
  for (const els of lineEls.values()) for (const el of els) el.classList.toggle('dead', closed.has(el.dataset.a) || closed.has(el.dataset.b));
  for (const [id, el] of stationEls) el.classList.toggle('closed', closed.has(id));
  if (geo) for (const id of geo.markers.keys()) geoStyle(id);
  renderList(); showPath(true);
}

function renderList() {
  const { paths } = result;
  $('#count').textContent = paths.length ? `· ${paths.length} of k = ${data.meta.k}` : '';
  $('#list').replaceChildren(...paths.map((p, i) => {
    const li = document.createElement('li');
    const via = [], chips = [];
    for (const e of p.path) if (e.mode !== 'walk' && e.route !== chips.at(-1)?.route) { if (chips.length) via.push(st(e.from)); chips.push(e); }
    li.innerHTML = `<span class="n">${i + 1}</span>
      <span><span class="modes">${chips.map(e => `<i style="--c:${ROUTE_LINE.get(e.route)?.color ?? '#888'}" title="${e.route}">${ROUTE_LINE.get(e.route)?.id ?? e.route}</i>`).join('')}</span>
        <span class="via">${via.length ? 'via ' + via.join(' · ') : 'direct'}</span>
        ${p.tags.map(t => `<span class="tag ${t}">${t}</span>`).join('')}</span>
      <span class="stat">${rp(p.fare)}<small>${p.time} min · ${p.transfers} xfer</small></span>`;
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
  for (const el of stationEls.values()) { el.classList.remove('on'); el.style.removeProperty('--delay'); }

  if (!p) {
    $('#best').innerHTML = `<div class="big none">No route</div><div>Blok M is unreachable with ${closed.size} station${closed.size > 1 ? 's' : ''} closed. Reopen one.</div>`;
    return;
  }
  const steps = p.path.filter(e => e.mode !== 'walk' || st(e.from) !== st(e.to)).map(e => {
    const line = ROUTE_LINE.get(e.route);
    return `<li><i style="--c:${line?.color ?? 'var(--walk)'}"></i>${MODE_LABEL[e.mode]} ${e.mode === 'walk' ? '' : (line?.id ?? e.route)} · ${st(e.from)} → ${st(e.to)} <span>· ${e.time} min${e.fare ? ' · ' + rp(e.fare) : ''}</span></li>`;
  });
  $('#best').innerHTML = `<div class="big">${rp(p.fare)} · ${p.time} min</div>
    <div>${p.transfers} transfer${p.transfers === 1 ? '' : 's'} · ${(p.dist / 1000).toFixed(1)} km${p.dist ? '' : ' (TJ hops unmeasured)'} · rank #${selected + 1}${p.tags.map(t => `<span class="tag ${t}">${t}</span>`).join('')}</div>
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
    segs.push({ el, b, len: el.lastChild.getTotalLength() });
  }
  const total = segs.reduce((s, x) => s + x.len, 0) || 1, DUR = 2.6;
  let t = 0;
  stationEls.get(st(start)).classList.add('on');
  stationEls.get(st(start)).style.setProperty('--delay', '0s');
  for (const s of segs) {
    const dur = DUR * s.len / total;
    s.el.style.setProperty('--len', s.len.toFixed(1)); s.el.style.setProperty('--dur', `${dur.toFixed(2)}s`); s.el.style.setProperty('--delay', `${t.toFixed(2)}s`);
    t += dur;
    const el = stationEls.get(s.b); el.classList.add('on'); el.style.setProperty('--delay', `${t.toFixed(2)}s`);
  }
  if (geo) geoRoute(p, segs.map(x => x.b));
  if (play) requestAnimationFrame(() => { map.classList.add('playing'); geo?.el.classList.add('playing'); });
}

// ── Map view: Leaflet on OpenStreetMap tiles, same state ─────────────────────
let geo = null;
const NAMED = line => line.stops.filter(x => !Array.isArray(x)).map(nameOf);
function geoStyle(id) {
  const mk = geo.markers.get(id), terminal = id === start || id === end, on = stationEls.get(id).classList.contains('on');
  mk.setStyle(closed.has(id)
    ? { color: '#f43f5e', dashArray: '2 2', fillColor: '#fee2e2', weight: 2 }
    : { color: terminal ? '#fff' : '#1f2937', dashArray: null, fillColor: terminal ? '#e11d48' : '#fff', weight: on ? 3 : 2 });
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
  for (const line of LINES) L.polyline(NAMED(line).map(n => GEO[n]), { color: line.color, weight: line.rail ? 5 : 3.5, opacity: .9, className: 'gline' }).addTo(lines);
  const markers = new Map();
  for (const [id, ll] of Object.entries(GEO)) {
    const terminal = id === start || id === end, xfer = stationEls.get(id).classList.contains('xfer');
    const mk = L.circleMarker(ll, { pane: 'stations', radius: terminal ? 8 : xfer ? 6.5 : 5, fillOpacity: 1, className: terminal ? '' : 'gstation' }).addTo(stations);
    mk.bindTooltip(id, { pane: 'labels', permanent: true, direction: 'right', offset: [8, 0], className: 'glabel ' + (terminal ? 'l0' : xfer ? 'l1' : 'l2') });
    if (!terminal) mk.on('click', () => { closed.has(id) ? closed.delete(id) : closed.add(id); recompute(); });
    mk.on('mouseover', () => { const n = result.criticality.get(id) || 0, k = result.paths.length; mk.setTooltipContent(`${id} · ${closed.has(id) ? 'closed' : `${n}/${k} routes`}`); });
    mk.on('mouseout', () => mk.setTooltipContent(id));
    markers.set(id, mk);
  }
  const tier = () => { const z = m.getZoom(); el.classList.toggle('z1', z < 13); el.classList.toggle('z2', z < 14); };
  m.on('zoomend', tier);
  geo = { el, m, routes, markers };
  m.invalidateSize();
  m.fitBounds(L.latLngBounds(Object.values(GEO)), { padding: [16, 16] });
  tier();
  for (const id of markers.keys()) geoStyle(id);
}
function geoRoute(p, stopsOn) {
  geo.routes.clearLayers();
  geo.el.classList.remove('playing');
  geo.el.classList.toggle('has-route', !!p);
  for (const id of geo.markers.keys()) geoStyle(id);
  if (!p) return;
  // Same hop sequence and timing as the schematic; each hop follows its line's stop order.
  const hops = [];
  for (const e of p.path) {
    const a = st(e.from), b = st(e.to);
    if (a === b) continue;
    const line = ROUTE_LINE.get(e.route);
    let pts = [GEO[a], GEO[b]];
    if (line) {
      const names = NAMED(line); let i = names.indexOf(a), j = names.indexOf(b);
      if (i >= 0 && j >= 0) { const rev = i > j; if (rev) [i, j] = [j, i]; pts = names.slice(i, j + 1).map(n => GEO[n]); if (rev) pts.reverse(); }
    }
    const walk = e.mode === 'walk';
    const casing = L.polyline(pts, { pane: 'routes', color: '#fff', weight: walk ? 9 : 14, className: 'groute gcasing' + (walk ? ' gwalk' : '') }).addTo(geo.routes);
    const ink = L.polyline(pts, { pane: 'routes', color: walk ? '#111827' : (line?.color ?? '#6b7280'), weight: walk ? 3 : 7, dashArray: walk ? '4 5' : null, className: 'groute' + (walk ? ' gwalk' : '') }).addTo(geo.routes);
    hops.push({ els: [casing._path, ink._path], len: ink._path.getTotalLength() });
  }
  const total = hops.reduce((s, h) => s + h.len, 0) || 1, DUR = 2.6;
  let t = 0;
  for (const h of hops) {
    const dur = DUR * h.len / total;
    for (const el of h.els) { el.style.setProperty('--len', h.len.toFixed(1)); el.style.setProperty('--dur', `${dur.toFixed(2)}s`); el.style.setProperty('--delay', `${t.toFixed(2)}s`); }
    t += dur;
  }
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
gStations.addEventListener('click', ev => {
  const grp = ev.target.closest('.station');
  if (!grp || grp.classList.contains('terminal')) return;
  const id = grp.dataset.id;
  closed.has(id) ? closed.delete(id) : closed.add(id);
  tip.hidden = true;
  recompute();
});
gStations.addEventListener('mousemove', ev => {
  const grp = ev.target.closest('.station');
  if (!grp) { tip.hidden = true; return; }
  const id = grp.dataset.id, n = result.criticality.get(id) || 0, k = result.paths.length;
  const lines = LINES.filter(l => l.stops.includes(id)).map(l => `<i style="--c:${l.color}">${l.id}</i>`).join('');
  tip.innerHTML = `<b>${id}</b><span class="lines">${lines}</span>${closed.has(id) ? 'closed · click to reopen' : n ? `on ${n} of ${k} routes${n === k && k ? ' · single point of failure' : ''}` : 'on no current route'}`;
  const r = $('.map').getBoundingClientRect();
  tip.style.left = `${ev.clientX - r.left}px`; tip.style.top = `${ev.clientY - r.top}px`;
  tip.hidden = false;
});
gStations.addEventListener('mouseleave', () => { tip.hidden = true; });

function readWeight() {
  wFare = +$('#w').value;
  $('#wout').value = wFare.toFixed(2);
  $('#wlabel').textContent = wFare < 0.35 ? 'Speed first' : wFare > 0.65 ? 'Budget first' : 'Balanced';
}
$('#w').addEventListener('input', () => { readWeight(); recompute(); });
$('#play').addEventListener('click', () => showPath(true));
$('#v-schematic').addEventListener('click', () => setView('schematic'));
$('#v-map').addEventListener('click', () => setView('map'));
$('#reset').addEventListener('click', () => { closed.clear(); recompute(); });

readWeight();
recompute();
window.transitlab = { get geo() { return geo; }, get result() { return result; }, closed };
