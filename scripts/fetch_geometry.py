"""Trace every line's geometry along real roads and rails, offline.

Writes public/data/geometry.json:  { lineId: { "A|B": [[lat, lon], ...] } }
for each pair of consecutive stops in public/lines.mjs.

  rail (KRL, MRT, LRT)  OSM railway ways from Overpass, shortest path along the
                        track network between the two stops.
  bus  (TransJakarta)   OSM busway + major-road ways from Overpass, shortest path
                        ignoring one-way rules (a router that obeys them snaps to
                        the wrong carriageway and U-turns kilometres away).

    python scripts/fetch_geometry.py            # only pairs not yet cached
    python scripts/fetch_geometry.py --refresh  # redo everything

Overpass is public and rate-limited: this runs once, not at page load.

Hand-edited after tracing: 4K and 6V "Tegal Mampang|Kejaksaan Agung" leave
Trunojoyo ~80 m before the CSW junction and go straight to the halte, so
neither line runs through CSW (they do not serve it). 1 and 4C stitch
Senayan|Bendungan Hilir through Semanggi, which corridor 1 does not stop at.
"""
from __future__ import annotations

import heapq
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINES_MJS = ROOT / "public" / "lines.mjs"
OUT = ROOT / "public" / "data" / "geometry.json"
UA = {"User-Agent": "transitlab-portfolio/1.0 (github.com/putra10)"}
BBOX = "-6.42,106.75,-6.15,106.93"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
RAIL_TYPE = {"Bogor": "rail", "Cikarang": "rail", "MRT": "subway", "LRT": "light_rail"}
# Buses on Sudirman run straight through the Semanggi interchange under the MRT
# viaduct; the road graph would send them round the cloverleaf ramps. Any bus
# hop between two of these stops is drawn along the MRT alignment instead.
SUDIRMAN = ["Blok M", "Kejaksaan Agung", "Bundaran Senayan", "Senayan", "Bendungan Hilir", "Dukuh Atas"]
ROADS = "motorway|trunk|primary|secondary|tertiary|busway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"


# ── Read lines.mjs without a JS runtime ───────────────────────────────────────
def load_lines():
    src = LINES_MJS.read_text(encoding="utf-8")
    geo = {m.group(1): (float(m.group(2)), float(m.group(3)))
           for m in re.finditer(r"'([^']+)':\s*\[(-?\d+\.\d+),\s*(\d+\.\d+)\]", src[src.index("export const GEO"):src.index("export const LABEL")])}
    lines = []
    for m in re.finditer(r"\{ id: '([^']+)'.*?stops: \[(.*?)\] \}", src[src.index("export const LINES"):], re.S):
        raw = re.findall(r"'(~?[^']+)'", m.group(2))
        # Rail pass-through stops are bus halte positions, off the track: skip them.
        stops = [x.lstrip("~") for x in raw if not (m.group(1) in RAIL_TYPE and x.startswith("~"))]
        lines.append((m.group(1), stops))
    return geo, lines


# ── Rail: Overpass network + Dijkstra ─────────────────────────────────────────
class OverpassDown(Exception):
    pass


def overpass(query: str):
    for host in OVERPASS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(host, data=urllib.parse.urlencode({"data": query}).encode(), headers=UA)
                return json.load(urllib.request.urlopen(req, timeout=180))
            except Exception as e:  # noqa: BLE001
                print(f"  overpass {host.split('/')[2]} attempt {attempt + 1}: {e}")
                time.sleep(5)
    raise OverpassDown("Overpass unreachable; try again later")


def haversine(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def network(label: str, selector: str, stitch_m: float):
    """Graph over OSM ways. Nodes closer than stitch_m are joined so parallel
    tracks / carriageways are traversable without hunting for a crossover."""
    print(f"fetching {label} ways…")
    data = overpass(f'[out:json][timeout:180];way[{selector}]({BBOX});out geom;')
    coords, adj = {}, {}
    for w in data["elements"]:
        ids, pts = w["nodes"], [(p["lat"], p["lon"]) for p in w["geometry"]]
        for i, nid in enumerate(ids):
            coords[nid] = pts[i]
        for x, y in zip(ids, ids[1:]):
            d = haversine(coords[x], coords[y])
            adj.setdefault(x, []).append((y, d))
            adj.setdefault(y, []).append((x, d))
    cell = stitch_m / 111000
    grid = {}
    for nid, (la, lo) in coords.items():
        grid.setdefault((int(la / cell), int(lo / cell)), []).append(nid)
    joined = 0
    for (gi, gj), ids in grid.items():
        near = [n for di in (-1, 0, 1) for dj in (-1, 0, 1) for n in grid.get((gi + di, gj + dj), [])]
        for x in ids:
            for y in near:
                if x < y and haversine(coords[x], coords[y]) <= stitch_m:
                    d = haversine(coords[x], coords[y]) + 1.0
                    adj.setdefault(x, []).append((y, d)); adj.setdefault(y, []).append((x, d)); joined += 1
    print(f"  {len(data['elements'])} ways, {len(coords)} nodes, {joined} stitches")
    return coords, adj


def nearest(coords, pt, limit=400):
    nid = min(coords, key=lambda n: haversine(coords[n], pt))
    return nid if haversine(coords[nid], pt) <= limit else None


def dijkstra(adj, coords, s, t):
    best, prev, pq = {s: 0.0}, {}, [(0.0, s)]
    while pq:
        d, n = heapq.heappop(pq)
        if n == t:
            break
        if d > best[n]:
            continue
        for nb, w in adj.get(n, []):
            nd = d + w
            if nd < best.get(nb, math.inf):
                best[nb], prev[nb] = nd, n
                heapq.heappush(pq, (nd, nb))
    if t not in best:
        return None
    path, n = [], t
    while n != s:
        path.append(coords[n]); n = prev[n]
    path.append(coords[s])
    return [[round(la, 6), round(lo, 6)] for la, lo in reversed(path)]


def along_mrt(out, geo, a, b):
    """Slice of the MRT trace between the points nearest to stops a and b."""
    mrt = out.get("MRT", {})
    path = None
    for key in ("Blok M|Bendungan Hilir", "Bendungan Hilir|Dukuh Atas"):
        seg = mrt.get(key)
        if seg:
            path = seg if path is None else path + seg[1:]
    if not path:
        return None
    i = min(range(len(path)), key=lambda k: haversine(path[k], geo[a]))
    j = min(range(len(path)), key=lambda k: haversine(path[k], geo[b]))
    if i == j:
        return None
    core = path[i:j + 1] if i < j else list(reversed(path[j:i + 1]))
    return [[*geo[a]]] + core + [[*geo[b]]]


def main(refresh: bool):
    geo, lines = load_lines()
    out = {} if refresh or not OUT.exists() else json.loads(OUT.read_text(encoding="utf-8"))
    nets = {}
    down = False
    for lid, stops in lines:
        cache = out.setdefault(lid, {})
        kind = RAIL_TYPE.get(lid, "road")
        for a, b in zip(stops, stops[1:]):
            key = f"{a}|{b}"
            if key in cache or f"{b}|{a}" in cache:
                continue
            pa, pb = geo[a], geo[b]
            if down:
                continue
            if kind not in nets:
                try:
                    nets[kind] = (network(f"highway~{ROADS}", f'"highway"~"^({ROADS})$"', 30) if kind == "road"
                                  else network(f"railway={kind}", f'"railway"="{kind}"', 15))
                except OverpassDown as e:
                    print(f"  {e}; leaving the remaining pairs untraced for now")
                    down = True
                    continue
            coords, adj = nets[kind]
            s, t = nearest(coords, pa), nearest(coords, pb)
            path = dijkstra(adj, coords, s, t) if s and t else None
            if path:
                path = [[*pa]] + path + [[*pb]]   # snap the ends onto the stops themselves
            if path:
                cache[key] = path
                straight, along = haversine(pa, pb), sum(haversine(p, q) for p, q in zip(path, path[1:]))
                flag = "  ⚠ long detour" if along > 2.2 * straight + 500 else ""
                print(f"{lid:9} {a} → {b}: {len(path)} pts, {along / 1000:.1f} km{flag}")
            else:
                print(f"{lid:9} {a} → {b}: NO PATH (falls back to straight)")
            OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Sudirman bus hops follow the MRT alignment through Semanggi.
    for lid, stops in lines:
        if lid in RAIL_TYPE:
            continue
        for a, b in zip(stops, stops[1:]):
            if a in SUDIRMAN and b in SUDIRMAN:
                path = along_mrt(out, geo, a, b)
                if path:
                    out.setdefault(lid, {}).pop(f"{b}|{a}", None)
                    out[lid][f"{a}|{b}"] = path
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", OUT.relative_to(ROOT), f"{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main("--refresh" in sys.argv)
