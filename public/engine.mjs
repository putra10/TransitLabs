// OPTG route engine. Port of cell 10 of tgoptggraph.ipynb.
// Pure functions, no DOM: node runs tests/engine.test.mjs against it.

// Binary heap keyed on [cost, ...]; arrays compare by first element.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** Adjacency list: node -> edges out of it. Edges are directed, as in the notebook. */
export function buildGraph(data) {
  const adj = new Map();
  for (const e of data.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e);
  }
  const station = new Map(data.nodes.map(n => [n.id, n.station]));
  return { adj, station, penalty: data.meta.transfer_penalty };
}

const isTransfer = (prev, mode) => prev && prev !== mode && mode !== 'walk';

/**
 * Dijkstra on state (node, arriving mode) so the transfer penalty is exact:
 * the notebook keys on node only, which can discard a slightly slower arrival
 * that would have avoided a later transfer.
 */
function dijkstra(g, start, end, blockedNodes, blockedEdges, closed = new Set()) {
  const best = new Map();           // "node|mode" -> cost
  const prev = new Map();           // "node|mode" -> [edge, prevKey]
  const pq = new Heap();
  const k0 = `${start}|`;
  best.set(k0, 0); pq.push([0, start, '', k0]);
  let endKey = null;
  while (pq.size) {
    const [cost, node, mode, key] = pq.pop();
    if (cost > best.get(key)) continue;
    if (node === end) { endKey = key; break; }
    for (const e of g.adj.get(node) || []) {
      if (blockedNodes.has(e.to) && e.to !== end) continue;
      if (blockedEdges.has(`${e.from}>${e.to}>${e.route}`)) continue;
      // A closed station cuts the line: a ride that passes through it is unavailable.
      if (e.via && e.via.some(s => closed.has(s))) continue;
      const nc = cost + e.time + (isTransfer(mode, e.mode) ? g.penalty : 0);
      const nk = `${e.to}|${e.mode}`;
      if (nc < (best.get(nk) ?? Infinity)) {
        best.set(nk, nc); prev.set(nk, [e, key]); pq.push([nc, e.to, e.mode, nk]);
      }
    }
  }
  if (endKey === null) return null;
  const path = [];
  for (let k = endKey; prev.has(k);) { const [e, pk] = prev.get(k); path.push(e); k = pk; }
  return path.reverse();
}

function summarize(g, start, edges) {
  let transfers = 0;
  for (let i = 1; i < edges.length; i++) if (isTransfer(edges[i - 1].mode, edges[i].mode)) transfers++;
  const raw = edges.reduce((s, e) => s + e.time, 0);
  const nodes = [start, ...edges.map(e => e.to)];
  const stOf = n => g.station.get(n) ?? n;
  // Same rides boarded at the same stations = same journey, however the
  // line's intermediate-stop edges were chained. Used to dedupe Yen output.
  const rides = [];
  for (const e of edges) if (e.mode !== 'walk' && e.route !== rides.at(-1)?.route) rides.push(e);
  const journey = rides.map(e => `${stOf(e.from)}:${e.route}`).join('>');
  return {
    path: edges, nodes, journey,
    stations: [...new Set(nodes.map(n => g.station.get(n) ?? n))],
    fare: edges.reduce((s, e) => s + e.fare, 0),
    rawTime: raw, time: raw + transfers * g.penalty,
    dist: edges.reduce((s, e) => s + e.dist, 0),
    transfers,
  };
}

/**
 * Yen's k-shortest simple paths by time (transfer penalty included).
 * Enumerates in the usual order but returns K *distinct journeys*: the line
 * graph reaches the same ride through several intermediate-stop edges, and
 * those would otherwise fill the list with copies. Capped at 10·K iterations.
 */
export function yen(g, start, end, K, closed = new Set()) {
  // Closed stations block every raw node drawn at that station.
  const closedNodes = new Set([...g.station].filter(([, s]) => closed.has(s)).map(([n]) => n));
  const first = dijkstra(g, start, end, closedNodes, new Set(), closed);
  if (!first) return [];
  const A = [summarize(g, start, first)];
  const B = new Heap();
  const seen = new Set([A[0].nodes.join('>')]);
  const journeys = new Set([A[0].journey]);
  for (let k = 1; journeys.size < K && k < 10 * K; k++) {
    const prevPath = A[k - 1].path, prevNodes = A[k - 1].nodes;
    for (let i = 0; i < prevPath.length; i++) {
      const spur = prevNodes[i];
      const rootNodes = new Set([...prevNodes.slice(0, i), ...closedNodes]);
      const blockedEdges = new Set();
      for (const p of A) {
        if (p.nodes.slice(0, i + 1).join('>') === prevNodes.slice(0, i + 1).join('>') && p.path[i]) {
          const e = p.path[i]; blockedEdges.add(`${e.from}>${e.to}>${e.route}`);
        }
      }
      const spurPath = dijkstra(g, spur, end, rootNodes, blockedEdges, closed);
      if (!spurPath) continue;
      const cand = summarize(g, start, [...prevPath.slice(0, i), ...spurPath]);
      const sig = cand.nodes.join('>');
      if (seen.has(sig)) continue;
      seen.add(sig); B.push([cand.time, cand]);
    }
    if (!B.size) break;
    const next = B.pop()[1];
    A.push(next); journeys.add(next.journey);
  }
  const out = [], done = new Set();
  for (const p of A) if (!done.has(p.journey)) { done.add(p.journey); out.push(p); }
  return out.slice(0, K);
}

/** Indices of paths not dominated on (fare, time). */
export function paretoFront(paths) {
  const front = new Set();
  paths.forEach((a, i) => {
    const dominated = paths.some((b, j) => j !== i && b.fare <= a.fare && b.time <= a.time && (b.fare < a.fare || b.time < a.time));
    if (!dominated) front.add(i);
  });
  return front;
}

/** Score = w·fare + (1−w)·time on min-max normalised values; returns paths sorted best first. */
export function rank(paths, wFare) {
  if (!paths.length) return [];
  const fares = paths.map(p => p.fare), times = paths.map(p => p.time);
  const [f0, f1, t0, t1] = [Math.min(...fares), Math.max(...fares), Math.min(...times), Math.max(...times)];
  const norm = (v, lo, hi) => hi > lo ? (v - lo) / (hi - lo) : 0;
  const scored = paths.map(p => ({ ...p, score: wFare * norm(p.fare, f0, f1) + (1 - wFare) * norm(p.time, t0, t1) }));
  scored.sort((a, b) => a.score - b.score);
  const pareto = paretoFront(scored);
  scored.forEach((p, i) => {
    p.tags = [];
    if (p.fare === f0) p.tags.push('cheapest');
    if (p.time === t0) p.tags.push('fastest');
    if (pareto.has(i)) p.tags.push('pareto');
  });
  return scored;
}

/** How many of the k paths pass through each station: a cheap criticality score. */
export function criticality(paths) {
  const c = new Map();
  for (const p of paths) for (const s of p.stations) c.set(s, (c.get(s) || 0) + 1);
  return c;
}

/** One call for the UI: closed stations + fare weight -> ranked paths. */
export function solve(g, data, { closed = new Set(), wFare = 0.5 } = {}) {
  const paths = rank(yen(g, data.meta.start, data.meta.end, data.meta.k, closed), wFare);
  return { paths, criticality: criticality(paths) };
}
