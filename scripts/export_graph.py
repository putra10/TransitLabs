"""Export the OPTG search graph to public/data/optg.json.

Replays cells 4, 8 and 10 of tgoptggraph.ipynb offline: parses the 64
candidate routes, prices every hop (field fares first, official formulas as
fallback), attaches Google Maps travel time from the frozen snapshot, and
records which display station each raw node belongs to.

    python scripts/export_graph.py            # reads scripts/raw/, writes JSON
    python scripts/export_graph.py --refetch  # refresh the two sheet CSVs first
"""
from __future__ import annotations

import csv
import heapq
import json
import math
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT.parent / "public" / "data" / "optg.json"

SHEET = "https://docs.google.com/spreadsheets/d/1nztzHDowgshQcoxeuiOERr5wlFW0CL8vNgXUy6WtCAc/export?format=csv"
ROUTES_URL = SHEET
PRICES_URL = SHEET + "&gid=983678603"

TRANSFER_PENALTY = 5  # minutes, same as the notebook

# ── Mode classification (cell 8) ──────────────────────────────────────────────
KRL_LINES = {"bogor line", "cikarang line", "tangerang line", "rangkasbitung line", "tanjung priok line"}
MRT_LINES = {"bundaran hi - lebak bulus", "lebak bulus - bundaran hi"}
LRT_LINES = {"cibubur line", "bekasi line lrt", "lrt jabodebek", "lrt jabodetabek", "jabodebek"}
LINE_TYPES = {"krl", "mrt", "lrt"}

FARE_CONFIG = {
    "transjakarta": {"type": "flat", "fare": 3_500},
    "krl": {"type": "tiered", "base_fare": 3_000, "base_dist_m": 25_000, "tier_fare": 1_000, "tier_dist_m": 10_000},
    "lrt": {"type": "linear", "base_fare": 5_000, "per_km": 700, "base_dist_m": 1_000, "min_fare": 5_000},
}
SPEED_DEFAULTS = {"walk": 75, "krl": 650, "lrt": 400, "mrt": 500, "transjakarta": 125}


def detect_type(mode: str) -> str:
    m = mode.strip().lower()
    if "jalan kaki" in m:
        return "walk"
    if m in KRL_LINES:
        return "krl"
    if m in MRT_LINES:
        return "mrt"
    if m in LRT_LINES:
        return "lrt"
    return "transjakarta"


def classify_mode(line: str) -> str:
    low = (line or "").lower().strip()
    if not low or any(x in low for x in ("jalan kaki", "integrasi", "selesai")):
        return "Walk"
    if "mrt" in low or "lebak bulus" in low or "bundaran hi" in low:
        return "MRT"
    if "lrt" in low or "cibubur line" in low or "velodrome" in low:
        return "LRT"
    if any(x in low for x in ("bogor line", "cikarang line", "tangerang line", "rangkasbitung line", "tanjung priok line", "krl")):
        return "KRL"
    return "TJ"


# ── Station names ─────────────────────────────────────────────────────────────
# Cell 8 uses these only for line-distance lookups.
LOOKUP_ALIASES = {"Blok M BCA": "Blok M", "St. MRT Blok M": "Blok M", "St. MRT Blok A": "Blok A", "Dukuh Atas": "Dukuh Atas BNI"}

# Cell 6 name normaliser, used by sheet_fare to match hops.
STRIP_PREFIXES = [r"^stasiun\s+", r"^st\.\s+", r"^terminal\s+", r"^halte\s+", r"^bus stop\s+", r"^mrt\s+", r"^lrt\s+", r"^krl\s+"]
STRIP_SUFFIXES = [r"\s+station$", r"\s+stasiun$", r"\s+terminal$", r"\s+indomaret$", r"\s+bca$", r"\s+bni$",
                  r"\s+arah barat$", r"\s+arah timur$", r"\s+jalur \d+$", r"\s+\d+$", r"\s+\(?integrasi\)?$"]
NODE_ALIASES = {
    "Universitas Indonesia": "UI", "Universitas Indonesia Train Station": "UI", "Stasiun UI": "UI",
    "St. MRT Blok M": "Blok M", "St. MRT Blok A": "Blok A", "CSW 1": "CSW", "Stasiun Sudirman": "Sudirman",
    "Stasiun Tebet": "Tebet", "Dukuh Atas BNI": "Dukuh Atas", "Pasar Minggu Station": "Pasar Minggu",
    "St. MRT Lebak Bulus": "Lebak Bulus", "St. Tj. Barat 2": "Tanjung Barat", "Fatmawati Indomaret": "Fatmawati",
    "Lebak Bulus Grab": "Lebak Bulus", "Blok M BCA": "Blok M", "Senayan Mastercard": "Senayan",
    "Istora Mandiri": "Istora", "Setiabudi Astra": "Setiabudi", "Cipete Raya": "Cipete",
}
NODE_PREFIX_ALIASES = {
    "Terminal Blok M": "Blok M", "Blok M": "Blok M", "St. MRT Fatmawati": "Fatmawati", "Tegal Parang": "Tegal Parang",
    "Tegal Mampang": "Tegal Mampang", "Pasar Minggu": "Pasar Minggu", "Terminal Pasar Minggu": "Pasar Minggu",
    "Bundaran Senayan": "Bundaran Senayan", "Komdak": "Komdak", "CSW": "CSW", "Pancoran": "Pancoran",
    "Cikoko": "Cikoko", "Duren Kalibata": "Duren Kalibata", "Cipete": "Cipete",
}


def normalize(name: str) -> str:
    s = name.lower().strip()
    for p in STRIP_PREFIXES + STRIP_SUFFIXES:
        s = re.sub(p, "", s)
    s = re.sub(r"\b(arah barat|arah timur|arah utara|arah selatan|jalur \d+)\b", "", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def apply_alias(name: str) -> str:
    if name in NODE_ALIASES:
        return NODE_ALIASES[name]
    for prefix in sorted(NODE_PREFIX_ALIASES, key=len, reverse=True):
        if name.startswith(prefix):
            return NODE_PREFIX_ALIASES[prefix]
    stripped = re.sub(r"^(st\.?|stasiun|terminal|halte|bus stop)\s+", "", name, flags=re.I).strip()
    if stripped and stripped != name:
        return apply_alias(stripped)
    return name


# Display node per raw station. The notebook keeps raw names as graph nodes;
# the schematic wants one dot per physical station. Everything not listed
# falls through apply_alias (which keeps Cawang and Cawang-Sentral distinct).
CANON = {
    "Universitas Indonesia Train Station": "Stasiun UI",  # walk from campus is real
    "Cawang-Sentral 2": "Cawang-Sentral",
    "Cikini Station": "Cikini",
    "St. Manggarai": "Manggarai",
    "Bus Stop Pasar Minggu": "Pasar Minggu",
    "Senayan Bank Jakarta": "Senayan",
}

def canon(name: str) -> str:
    return CANON.get(name) or apply_alias(name)


# ── Cell 8: fares ─────────────────────────────────────────────────────────────
def parse_route(route_str: str) -> list[dict]:
    s = re.sub(r"\b(Start|End):\s*", "", route_str).strip()
    parts = re.split(r"\s*-+\s*\[\s*(.+?)\s*\]\s*-+>\s*", s)
    stops = [p.strip() for p in parts[0::2] if p.strip()]
    modes = [p.strip() for p in parts[1::2]]
    if len(stops) != len(modes) + 1:
        raise ValueError(f"Malformed route: {route_str}")
    return [{"origin": stops[i], "destination": stops[i + 1], "mode": m, "ttype": detect_type(m)} for i, m in enumerate(modes)]


def load_prices(path: Path) -> dict[str, list[tuple]]:
    rows = list(csv.reader(path.open(encoding="utf-8")))
    header = [h.strip().lower() for h in rows[0]]
    col = lambda kind: {int(m.group(1)): i for i, h in enumerate(header) if (m := re.match(rf"^{kind}\s*(\d+)$", h))}
    titik, moda, harga = col("titik"), col("moda"), col("harga")
    out = {}
    for row in rows[1:]:
        rid = row[0].strip() if row else ""
        if not rid:
            continue
        hops = []
        for i in range(1, max(titik) + 1):
            ti = titik.get(i)
            if ti is None or ti >= len(row) or not row[ti].strip():
                break
            m = row[moda[i]].strip() if i in moda and moda[i] < len(row) else ""
            h = re.sub(r"[^\d]", "", row[harga[i]]) if i in harga and harga[i] < len(row) else ""
            hops.append((row[ti].strip(), m or None, int(h) if h else None))
        out[rid] = hops
    return out


def build_line_graph(dist_cache: dict) -> dict:
    g = defaultdict(lambda: defaultdict(dict))
    for key, dist in dist_cache.items():
        parts = key.split("||")
        if len(parts) == 3 and dist is not None:
            a, b, mode = parts
            g[mode][a][b] = dist
            g[mode][b][a] = dist
    return g


def path_distance(g: dict, mode: str, o: str, d: str):
    if o == d:
        return 0
    sub = g.get(mode)
    if not sub or o not in sub or d not in sub:
        return None
    pq, best = [(0, o)], {o: 0}
    while pq:
        dist, n = heapq.heappop(pq)
        if dist > best.get(n, math.inf):
            continue
        if n == d:
            return dist
        for nb, w in sub[n].items():
            if dist + w < best.get(nb, math.inf):
                best[nb] = dist + w
                heapq.heappush(pq, (dist + w, nb))
    return None


def lookup_dist(dist_cache, line_graph, o, d, mode, ttype):
    if ttype in LINE_TYPES:
        o, d = LOOKUP_ALIASES.get(o, o), LOOKUP_ALIASES.get(d, d)
    for k in (f"{o}||{d}||{mode}", f"{d}||{o}||{mode}"):
        if k in dist_cache:
            return dist_cache[k]
    return path_distance(line_graph, mode, o, d) if ttype in LINE_TYPES else None


def calc_fare(ttype: str, dist_m) -> int:
    if ttype == "walk":
        return 0
    if ttype == "mrt":
        return 0 if not dist_m else math.floor((1500 + 850 * round(dist_m / 1000)) / 1000 + 0.5) * 1000
    cfg = FARE_CONFIG[ttype]
    if cfg["type"] == "flat":
        return cfg["fare"]
    if not dist_m:
        return 0
    if cfg["type"] == "tiered":
        if dist_m <= cfg["base_dist_m"]:
            return cfg["base_fare"]
        return cfg["base_fare"] + math.ceil((dist_m - cfg["base_dist_m"]) / cfg["tier_dist_m"]) * cfg["tier_fare"]
    extra_km = math.ceil(max(0.0, dist_m / 1000 - cfg["base_dist_m"] / 1000))
    return max(cfg["min_fare"], cfg["base_fare"] + extra_km * cfg["per_km"])


def sheet_fare(prices, rid, o, d, mode):
    hops = prices.get(rid) or []
    cls = classify_mode(mode)
    o, d = normalize(apply_alias(o)), normalize(apply_alias(d))
    best = (0, None)
    for i in range(len(hops) - 1):
        titik, moda, harga = hops[i]
        if harga is None or classify_mode(moda or "") != cls:
            continue
        so, sd = normalize(apply_alias(titik)), normalize(apply_alias(hops[i + 1][0]))
        best = max(best, ((so == o) + (sd == d), harga), key=lambda t: t[0])
    return best[1] if best[0] > 0 else None


def price_route(rid, route_str, prices, dist_cache, line_graph) -> list[dict]:
    segs, in_tj = parse_route(route_str), False
    for s in segs:
        s["dist_m"], s["fare"], s["tj_block"] = None, 0, False
        sheet = None if s["ttype"] == "walk" else sheet_fare(prices, rid, s["origin"], s["destination"], s["mode"])
        if s["ttype"] == "walk":
            if "integrasi" not in s["mode"].lower():
                in_tj = False
        elif s["ttype"] == "transjakarta":
            # One tap-in per contiguous TJ block; inner corridor hops are free.
            s["fare"] = sheet if sheet is not None else (0 if in_tj else FARE_CONFIG["transjakarta"]["fare"])
            in_tj = True
        else:
            in_tj = False
            s["dist_m"] = lookup_dist(dist_cache, line_graph, s["origin"], s["destination"], s["mode"], s["ttype"])
            s["fare"] = sheet if sheet is not None else calc_fare(s["ttype"], s["dist_m"])
    return segs


# ── Cell 10: times + search graph ─────────────────────────────────────────────
def main(refetch: bool = False) -> None:
    if refetch:
        for url, name in ((ROUTES_URL, "routes.csv"), (PRICES_URL, "prices.csv")):
            (RAW / name).write_bytes(urllib.request.urlopen(url, timeout=15).read())
            print("fetched", name)

    time_cache = json.loads((RAW / "maps_times_cache.json").read_text(encoding="utf-8"))
    dist_cache = json.loads((RAW / "maps_distance_cache.json").read_text(encoding="utf-8"))
    prices = load_prices(RAW / "prices.csv")
    line_graph = build_line_graph(dist_cache)

    routes = [(r[0].strip(), r[1].strip()) for r in csv.reader((RAW / "routes.csv").open(encoding="utf-8"))
              if len(r) > 1 and r[0].strip() and r[0].strip().lower() not in {"id", "route id", "rute id"}]

    speeds = defaultdict(list)
    for key, t in time_cache.items():
        d = dist_cache.get(key)
        if t and d and len(key.split("||")) == 3:
            speeds[key.split("||")[2]].append(d / t)
    route_speed = {k: sum(v) / len(v) for k, v in speeds.items()}

    edges: dict[tuple, dict] = {}
    dropped = []
    for rid, rstr in routes:
        for s in price_route(rid, rstr, prices, dist_cache, line_graph):
            o, d, route, ttype = s["origin"], s["destination"], s["mode"], s["ttype"]
            dist = s["dist_m"] or 0.0
            t = time_cache.get(f"{o}||{d}||{route}")
            if t is None:
                speed = route_speed.get(route, SPEED_DEFAULTS.get(ttype, 150))
                if dist > 0 and speed > 0:
                    t = dist / speed
                elif ttype == "walk":
                    t = 3
                else:
                    dropped.append(f"{o} -> {d} ({route})")
                    continue
            key = (o, d, route)
            if key in edges:
                # Same hop priced in several routes: keep the tap-in fare so a
                # TJ edge is never free out of context (the JS engine applies
                # free transfers per contiguous TJ block instead).
                edges[key]["fare"] = max(edges[key]["fare"], s["fare"])
                continue
            edges[key] = {"from": o, "to": d, "route": route, "mode": ttype,
                          "fare": s["fare"], "time": round(t, 2), "dist": round(dist)}

    # Graph nodes stay as the notebook's raw names (so alias walks keep their
    # minutes); each carries the display station the schematic draws it at.
    nodes = sorted({e["from"] for e in edges.values()} | {e["to"] for e in edges.values()})
    stations = sorted({canon(n) for n in nodes})

    out = {
        "meta": {"start": "UI", "end": "Blok M", "transfer_penalty": TRANSFER_PENALTY, "k": 10,
                 "source": "tgoptggraph.ipynb, Maps snapshot 2026-09-11 (Mon 2026-09-14 11:00 WIB)"},
        "stations": stations,  # layout + coordinates: public/lines.mjs
        "nodes": [{"id": n, "station": canon(n)} for n in nodes],
        "edges": list(edges.values()),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT.parent)}: {len(stations)} stations, {len(nodes)} nodes, {len(edges)} edges, {len(routes)} routes")
    for d in sorted(set(dropped)):
        print("  dropped (no time/dist):", d)


if __name__ == "__main__":
    main(refetch="--refetch" in sys.argv)
