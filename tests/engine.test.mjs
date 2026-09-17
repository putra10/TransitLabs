// node tests/engine.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraph, solve, yen, paretoFront, passes } from '../public/engine.mjs';
import { annotateVia } from '../public/lines.mjs';

const data = annotateVia(JSON.parse(readFileSync(new URL('../public/data/optg.json', import.meta.url), 'utf8')));
const g = buildGraph(data);

// Baseline. The notebook's k=10 held four copies of the KRL→KRL→MRT trip; with
// one slot per distinct journey the fastest is still Rp 13,000 / 61 min and the
// cheapest Rp 6,500 / 67 min, and the balanced weight now picks the cheap one.
const { paths, criticality } = solve(g, data);
assert.equal(paths.length, 10, 'ten paths');
assert.equal(new Set(paths.map(p => p.journey)).size, 10, 'distinct journeys');
const best = paths[0];
assert.equal(best.fare, 6500);
assert.equal(best.time, 67);
const fastest = paths.find(p => p.tags.includes('fastest'));
assert.equal(fastest.fare, 13000);
assert.equal(fastest.time, 61);
assert.equal(fastest.transfers, 2);
assert.deepEqual(fastest.path.map(e => e.mode).filter(m => m !== 'walk'), ['krl', 'krl', 'mrt']);
assert.ok(paths.every(p => p.nodes[0] === 'UI' && p.nodes.at(-1) === 'Blok M'));
assert.ok(paths.every(p => new Set(p.nodes).size === p.nodes.length), 'simple paths');

// Weight extremes reorder the same set.
assert.equal(solve(g, data, { wFare: 1 }).paths[0].fare, 6500);
assert.equal(solve(g, data, { wFare: 0 }).paths[0].time, 61);

// Closing a station removes it from every path and the engine reroutes.
const closed = new Set(['Manggarai']);
const rerouted = solve(g, data, { closed }).paths;
assert.ok(rerouted.length > 0, 'still reachable');
assert.ok(rerouted.every(p => !p.stations.includes('Manggarai')));
assert.ok(Math.min(...rerouted.map(p => p.time)) >= fastest.time, 'closure never speeds things up');

// A closed station cuts the line through it: with Duren Kalibata closed, no KRL
// ride from Stasiun UI can reach Cawang or anything beyond, even though the
// graph edge itself does not touch Duren Kalibata.
assert.ok(paths.some(p => p.path.some(e => e.via.includes('Duren Kalibata'))), 'baseline rides through Duren Kalibata');
const cut = solve(g, data, { closed: new Set(['Duren Kalibata']) }).paths;
assert.ok(cut.length > 0, 'still reachable by other lines');
assert.ok(cut.every(p => p.path.every(e => !e.via.includes('Duren Kalibata') && !p.stations.includes('Duren Kalibata'))));
assert.ok(cut.every(p => !p.path.some(e => e.route === 'Bogor Line' && p.stations.includes('Cawang'))), 'no KRL into Cawang');

// Closing the only exit strands the traveller.
assert.deepEqual(yen(g, 'UI', 'Blok M', 3, { closed: new Set(['Stasiun UI', 'Manggarai', 'Pasar Minggu', 'Fatmawati']) }), []);

// Transport filter: buses only, then rail only.
const busOnly = solve(g, data, { modes: new Set(['transjakarta']) }).paths;
assert.ok(busOnly.length > 0 && busOnly.every(p => p.path.every(e => e.mode === 'walk' || e.mode === 'transjakarta')));
const railOnly = solve(g, data, { modes: new Set(['krl', 'mrt', 'lrt']) }).paths;
assert.ok(railOnly.length > 0 && railOnly.every(p => p.path.every(e => e.mode !== 'transjakarta')));
assert.deepEqual(solve(g, data, { modes: new Set(['lrt']) }).paths, [], 'LRT alone cannot reach Blok M');

// Must pass: every journey stops at or rides through the station.
const viaTebet = solve(g, data, { must: ['Tebet'] }).paths;
assert.ok(viaTebet.length > 0 && viaTebet.every(p => passes(p, 'Tebet')));
assert.ok(viaTebet.some(p => !p.stations.includes('Tebet')), 'riding through counts, not only stopping');
const viaTwo = solve(g, data, { must: ['Manggarai', 'Dukuh Atas'] }).paths;
assert.ok(viaTwo.length > 0 && viaTwo.every(p => passes(p, 'Manggarai') && passes(p, 'Dukuh Atas')));
assert.deepEqual(solve(g, data, { must: ['Tebet'], closed: new Set(['Tebet']) }).paths, [], 'must pass a closed station is impossible');

// Pareto: dominated point excluded.
assert.deepEqual([...paretoFront([{ fare: 1, time: 1 }, { fare: 2, time: 2 }, { fare: 0, time: 3 }])], [0, 2]);

// Criticality counts stations the traveller actually passes.
assert.equal(criticality.get('UI'), 10);
assert.equal(criticality.get('Blok M'), 10);

console.log('ok:', paths.map(p => `${p.fare}/${p.time}`).join(' '));
