import { buildGraph, solve } from './engine.mjs';

const W = 900, H = 620, PAD = { l: 70, r: 110, t: 40, b: 50 };
const MODE_LABEL = { krl: 'KRL', mrt: 'MRT', lrt: 'LRT', transjakarta: 'TJ', walk: 'walk' };
const CSS_MODE = m => (m === 'transjakarta' ? 'tj' : m);
// Label nudges [dx, dy, anchor] for crowded spots; everything else sits right of its dot.
const LABEL = {
  'Blok M': [-14, 5, 'end'], 'CSW': [-10, -8, 'end'], 'Kejaksaan Agung': [12, 12, 'start'], 'Bundaran Senayan': [12, -5, 'start'],
  'Senayan': [-12, 4, 'end'], 'Bendungan Hilir': [-12, 4, 'end'], 'Semanggi': [10, -6, 'start'], 'Blok A': [-12, 4, 'end'],
  'Dukuh Atas': [-12, -4, 'end'], 'Sudirman': [10, 12, 'start'], 'Galunggung': [10, 8, 'start'], 'SMPN 8': [-12, 4, 'end'],
  'Cikini': [10, -4, 'start'], 'Cawang': [10, -6, 'start'], 'Cawang-Sentral': [10, 10, 'start'], 'Cikoko': [-12, 4, 'end'],
  'Pancoran': [4, 16, 'middle'], 'Tegal Parang': [4, -10, 'middle'], 'Tegal Mampang': [-12, -4, 'end'], 'Hotel Maharadja': [-12, 6, 'end'],
  'Kuningan': [10, 4, 'start'], 'Simpang Kuningan': [-12, -6, 'end'], 'Fatmawati': [-12, 6, 'end'], 'Kantor Pos Fatmawati': [10, -4, 'start'],
  'UI': [-14, 5, 'end'], 'Stasiun UI': [12, 5, 'start'], 'Depok Baru': [12, 5, 'start'],
};

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

// ── Projection ────────────────────────────────────────────────────────────────
const lats = data.stations.map(s => s.lat), lons = data.stations.map(s => s.lon);
const [la0, la1, lo0, lo1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
const pos = new Map(data.stations.map(s => [s.id, {
  x: PAD.l + (s.lon - lo0) / (lo1 - lo0) * (W - PAD.l - PAD.r),
  y: PAD.t + (la1 - s.lat) / (la1 - la0) * (H - PAD.t - PAD.b),
}]));
const st = n => g.station.get(n) ?? n;

// ── Static network ────────────────────────────────────────────────────────────
const map = $('#map');
const gEdges = svgEl('g'), gRoute = svgEl('g'), gStations = svgEl('g');
map.append(gEdges, gRoute, gStations);

// One line per (station pair, mode), parallel modes offset sideways.
const pairs = new Map();
for (const e of data.edges) {
  const a = st(e.from), b = st(e.to);
  if (a === b) continue;
  const key = [a, b].sort().join('|');
  if (!pairs.has(key)) pairs.set(key, new Map());
  pairs.get(key).set(e.mode, [a, b]);
}
const edgeEls = [];
for (const modes of pairs.values()) {
  const n = modes.size;
  [...modes.entries()].forEach(([mode, [a, b]], i) => {
    const p = pos.get(a), q = pos.get(b);
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1;
    const off = (i - (n - 1) / 2) * 5, ox = -dy / L * off, oy = dx / L * off;
    const el = svgEl('line', { x1: p.x + ox, y1: p.y + oy, x2: q.x + ox, y2: q.y + oy, class: `edge ${CSS_MODE(mode)}`, style: `--c:var(--${CSS_MODE(mode)})` });
    el.dataset.a = a; el.dataset.b = b;
    gEdges.append(el); edgeEls.push(el);
  });
}

const stationEls = new Map();
for (const s of data.stations) {
  const { x, y } = pos.get(s.id);
  const terminal = s.id === start || s.id === end;
  const grp = svgEl('g', { class: 'station' + (terminal ? ' terminal' : ''), transform: `translate(${x},${y})` });
  const [dx, dy, anchor] = LABEL[s.id] || [10, 4, 'start'];
  grp.append(svgEl('circle', { class: 'pulse', r: 8 }), svgEl('circle', { r: 5 }), svgEl('text', { x: dx, y: dy, 'text-anchor': anchor }));
  grp.querySelector('text').textContent = s.id;
  grp.dataset.id = s.id;
  gStations.append(grp); stationEls.set(s.id, grp);
}

// ── State ─────────────────────────────────────────────────────────────────────
const closed = new Set();
let wFare = 0.5, result, selected = 0;

function recompute() {
  result = solve(g, data, { closed, wFare });
  selected = 0;
  for (const el of edgeEls) el.classList.toggle('dead', closed.has(el.dataset.a) || closed.has(el.dataset.b));
  for (const [id, el] of stationEls) el.classList.toggle('closed', closed.has(id));
  renderList(); showPath(true);
}

function renderList() {
  const { paths } = result;
  $('#count').textContent = paths.length ? `· ${paths.length} of k = ${data.meta.k}` : '';
  $('#list').replaceChildren(...paths.map((p, i) => {
    const li = document.createElement('li');
    const via = [];
    let last = null;
    for (const e of p.path) if (e.mode !== 'walk') { if (last && e.route !== last) via.push(st(e.from)); last = e.route; }
    li.innerHTML = `<span class="n">${i + 1}</span>
      <span><span class="modes">${p.path.filter(e => e.mode !== 'walk').map(e => `<i style="--c:var(--${CSS_MODE(e.mode)})" title="${e.route}"></i>`).join('')}</span>
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
  for (const el of stationEls.values()) { el.classList.remove('on'); el.style.removeProperty('--delay'); }

  if (!p) {
    $('#best').innerHTML = `<div class="big none">No route</div><div>Blok M is unreachable with ${closed.size} station${closed.size > 1 ? 's' : ''} closed. Reopen one.</div>`;
    return;
  }
  // Best-route card
  const steps = p.path.filter(e => e.mode !== 'walk' || st(e.from) !== st(e.to)).map(e =>
    `<li><i style="--c:var(--${CSS_MODE(e.mode)})"></i>${MODE_LABEL[e.mode]} ${e.mode === 'walk' ? '' : e.route} · ${st(e.from)} → ${st(e.to)} <span>· ${e.time} min${e.fare ? ' · ' + rp(e.fare) : ''}</span></li>`);
  $('#best').innerHTML = `<div class="big">${rp(p.fare)} · ${p.time} min</div>
    <div>${p.transfers} transfer${p.transfers === 1 ? '' : 's'} · ${(p.dist / 1000).toFixed(1)} km${p.dist ? '' : ' (TJ hops unmeasured)'} · rank #${selected + 1}${p.tags.map(t => `<span class="tag ${t}">${t}</span>`).join('')}</div>
    <ul class="steps">${steps.join('')}</ul>`;

  // Route overlay: one segment per hop, animated in sequence by length.
  const segs = [];
  for (const e of p.path) {
    const a = st(e.from), b = st(e.to);
    if (a === b) continue;
    const P = pos.get(a), Q = pos.get(b);
    segs.push({ e, a, b, P, Q, len: Math.hypot(Q.x - P.x, Q.y - P.y) });
  }
  const total = segs.reduce((s, x) => s + x.len, 0), DUR = 2.6;
  let t = 0;
  stationEls.get(st(start)).classList.add('on');
  stationEls.get(st(start)).style.setProperty('--delay', '0s');
  for (const s of segs) {
    const dur = DUR * s.len / total;
    gRoute.append(svgEl('line', { x1: s.P.x, y1: s.P.y, x2: s.Q.x, y2: s.Q.y, class: `route ${CSS_MODE(s.e.mode)}`,
      style: `--c:var(--${CSS_MODE(s.e.mode)});--len:${s.len.toFixed(1)};--dur:${dur.toFixed(2)}s;--delay:${t.toFixed(2)}s` }));
    t += dur;
    const el = stationEls.get(s.b); el.classList.add('on'); el.style.setProperty('--delay', `${t.toFixed(2)}s`);
  }
  if (play) requestAnimationFrame(() => map.classList.add('playing'));
}

// ── Events ────────────────────────────────────────────────────────────────────
gStations.addEventListener('click', ev => {
  const grp = ev.target.closest('.station');
  if (!grp || grp.classList.contains('terminal')) return;
  const id = grp.dataset.id;
  closed.has(id) ? closed.delete(id) : closed.add(id);
  tip.hidden = true;
  recompute();
});
const tip = $('#tip');
gStations.addEventListener('mousemove', ev => {
  const grp = ev.target.closest('.station');
  if (!grp) { tip.hidden = true; return; }
  const id = grp.dataset.id, n = result.criticality.get(id) || 0, k = result.paths.length;
  tip.innerHTML = `<b>${id}</b>${closed.has(id) ? 'closed · click to reopen' : n ? `on ${n} of ${k} routes${n === k && k ? ' · single point of failure' : ''}` : 'on no current route'}`;
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
$('#reset').addEventListener('click', () => { closed.clear(); recompute(); });

readWeight();
recompute();
