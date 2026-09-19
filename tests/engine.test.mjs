// node tests/engine.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGraph, solve, yen, paretoFront, passes } from '../public/engine.mjs';
import { annotateVia, LINES, STATIONS } from '../public/lines.mjs';

const data = annotateVia(JSON.parse(readFileSync(new URL('../public/data/optg.json', import.meta.url), 'utf8')));
const g = buildGraph(data);

// Corridor 1 serves Bendungan Hilir, not Semanggi. The two stations connect
// through the explicit directed walking transfer in the project graph.
const corridor1 = LINES.find(line => line.id === '1');
assert.ok(corridor1.stops.includes('Bendungan Hilir'));
assert.ok(!corridor1.stops.includes('Semanggi'));
const corridor1LongEdge = data.edges.find(e => e.route === '1' && e.from === 'Dukuh Atas' && e.to === 'Blok M');
assert.ok(corridor1LongEdge.via.includes('Bendungan Hilir'));
assert.ok(!corridor1LongEdge.via.includes('Semanggi'));
assert.equal(STATIONS.Semanggi[1], STATIONS['Bendungan Hilir'][1], 'Semanggi and Bendungan Hilir align for the walking transfer');
assert.ok(STATIONS.Semanggi[0] > STATIONS['Bendungan Hilir'][0], 'Semanggi sits to the right of Bendungan Hilir');
assert.ok(data.edges.some(e => e.from === 'Semanggi' && e.to === 'Bendungan Hilir' && e.mode === 'walk'));
const mrt = LINES.find(line => line.id === 'MRT');
assert.ok(mrt.stops.includes('Bendungan Hilir'));
assert.ok(!mrt.stops.some(stop => typeof stop === 'string' && stop.replace(/^~/, '') === 'Semanggi'));

// Corridor 13 terminates at CSW and Corridor 1 starts at Kejaksaan Agung.
// The interchange between them must remain an explicit walking edge.
assert.ok(data.edges.some(e => e.from === 'CSW' && e.to === 'Kejaksaan Agung' && e.mode === 'walk'));
assert.ok(!LINES.some(line => line.stops.includes('CSW') && line.stops.includes('Kejaksaan Agung')));

// Baseline from the project spreadsheet (Sheet13 minutes, Sheet12 fares).
// Cheapest is TJ D21 then 1E with a free TransJakarta transfer, Rp 3,500 / 70 min;
// fastest is D21 then MRT, Rp 10,500 / 52 min. The balanced weight picks the cheap one.
const { paths, criticality } = solve(g, data);
assert.equal(paths.length, 10, 'ten paths');
assert.equal(new Set(paths.map(p => p.journey)).size, 10, 'distinct journeys');
const best = paths[0];
assert.equal(best.fare, 3500);
assert.equal(best.time, 70);
const fastest = paths.find(p => p.tags.includes('fastest'));
assert.equal(fastest.fare, 10500);
assert.equal(fastest.time, 52);
assert.equal(fastest.transfers, 1);
assert.deepEqual(fastest.path.map(e => e.mode).filter(m => m !== 'walk'), ['transjakarta', 'mrt']);
assert.ok(paths.every(p => p.nodes[0] === 'UI' && p.nodes.at(-1) === 'Blok M'));
assert.ok(paths.every(p => new Set(p.nodes).size === p.nodes.length), 'simple paths');

// Weight extremes reorder the same set.
assert.equal(solve(g, data, { wFare: 1 }).paths[0].fare, 3500);
assert.equal(solve(g, data, { wFare: 0 }).paths[0].time, 52);

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
