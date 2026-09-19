"""Export the OPTG search graph to public/data/optg.json from the project
spreadsheet.

The team's Google Sheet already holds every route broken into hops:
  Sheet13      route_id, origin, destination, mode, ttype, time_min
  Sheet12      route_id, origin, destination, mode, ttype, dist_m, fare, note
  Rute Tabel   ID, Titik 1, Moda 1, Harga 1, Titik 2, ...   (fares recorded in the field)
Rows are joined hop by hop. Minutes come from Sheet13, distance from Sheet12,
and the fare from Rute Tabel first, because that is what the team paid; the
Sheet12 fare is only the fallback when Rute Tabel has no value for the hop.
Only routes listed in the clean tab are used. TransJakarta edges are marked
BRT or not; the engine charges the flat tap-in except when a BRT corridor
follows another BRT corridor, which is the pattern in the field fares. Walking hops have no
minutes in the sheet and get WALK_MIN.

    python scripts/export_graph.py            # reads scripts/raw/sheet.xlsx
    python scripts/export_graph.py --refetch  # download the workbook again first
"""
from __future__ import annotations

import json
import math
import re
import sys
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT.parent / "public" / "data" / "optg.json"
SHEET_ID = "1nztzHDowgshQcoxeuiOERr5wlFW0CL8vNgXUy6WtCAc"
XLSX_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"
TIME_TAB, FARE_TAB, FIELD_TAB = "Sheet13", "Sheet12", "Rute Tabel"
CLEAN_TAB = "Copy of Rute Mentah"   # the 64 vetted routes; other tabs carry drafts
TJ_TAP_IN = 3500                    # flat TransJakarta fare
NON_BRT = {"4B", "D11", "D21"}       # separate fare systems: boarding after them always pays
EXCLUDED = {"AC52A"}                # services the team decided not to use: any route riding them is dropped

TRANSFER_PENALTY = 5   # minutes per change of mode, as in the notebook
WALK_MIN = 3           # the sheet leaves walking hops blank; notebook default


# ── Station names ─────────────────────────────────────────────────────────────
# Name normaliser and aliases from the project notebook, so raw stop names map
# onto one display station each.
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


# ── Field fares (Rute Tabel) ──────────────────────────────────────────────────
def load_field_fares(ws) -> dict[str, list[tuple]]:
    """{route_id: [(titik, moda, harga_or_None), ...]} from the wide Rute Tabel layout."""
    raw = [r for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)]
    header = [str(h or "").strip().lower() for h in raw[0]]
    col = lambda kind: {int(m.group(1)): i for i, h in enumerate(header) if (m := re.match(rf"^{kind}\s*(\d+)$", h))}
    titik, moda, harga = col("titik"), col("moda"), col("harga")
    out = {}
    for row in raw[1:]:
        rid = str(row[0] or "").strip()
        if not rid.startswith("Rute"):
            continue
        hops = []
        for i in range(1, max(titik) + 1):
            ti = titik.get(i)
            if ti is None or ti >= len(row) or row[ti] in (None, ""):
                break
            m = row[moda[i]] if i in moda and moda[i] < len(row) else None
            h = row[harga[i]] if i in harga and harga[i] < len(row) else None
            h = int(h) if isinstance(h, (int, float)) else (int(re.sub(r"[^\d]", "", h)) if isinstance(h, str) and re.sub(r"[^\d]", "", h) else None)
            hops.append((str(row[ti]).strip(), label(m) if m is not None else None, h))
        out[rid] = hops
    return out


def field_total(ws, rid_col=0, total_col=35):
    """Column AJ ('Total Harga') per route: the fare the team recorded for the whole trip."""
    out = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[rid_col] and isinstance(r[total_col], (int, float)):
            out[str(r[rid_col]).strip()] = int(r[total_col])
    return out


def field_fare(prices, rid, o, d, mode):
    """The recorded fare for hop o->d on `rid`, matched by normalised stop names and mode class."""
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


# ── Build ─────────────────────────────────────────────────────────────────────
def rows(ws):
    return [r for r in ws.iter_rows(values_only=True) if any(c is not None for c in r)][1:]


def label(v):
    """Corridor numbers arrive from the workbook as floats: 1.0 -> "1"."""
    return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v).strip()


def num(v):
    return float(v) if isinstance(v, (int, float)) else None


def main(refetch: bool = False) -> None:
    xlsx = RAW / "sheet.xlsx"
    if refetch or not xlsx.exists():
        xlsx.write_bytes(urllib.request.urlopen(XLSX_URL, timeout=60).read())
        print("fetched", xlsx.name)
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)  # cached values, AJ is a formula
    listed = {str(r[0]).strip() for r in rows(wb[CLEAN_TAB]) if r[0]}
    field = load_field_fares(wb[FIELD_TAB])
    totals = field_total(wb[FIELD_TAB])
    # A route whose recorded total (column AJ) is 0 or missing was dropped by the
    # team: it contributes nothing, not even hops for the engine to stitch.
    dropped = sorted(rid for rid in listed if not totals.get(rid))
    rides_excluded = {str(r[0]).strip() for r in rows(wb[TIME_TAB]) if label(r[5]) in EXCLUDED}
    dropped += sorted(rid for rid in listed - set(dropped) if rid in rides_excluded)
    clean = listed - set(dropped)
    if dropped:
        print(f"  dropped {len(dropped)} route(s) (no AJ total, or riding {'/'.join(sorted(EXCLUDED))}): {', '.join(dropped)}")
    times = [r for r in rows(wb[TIME_TAB]) if r[0] in clean]
    fares = [r for r in rows(wb[FARE_TAB]) if r[0] in clean]
    geo = {m.group(1): (float(m.group(2)), float(m.group(3)))
           for m in re.finditer(r"'([^']+)':\s*\[(-?\d+\.\d+),\s*(\d+\.\d+)\]", (ROOT.parent / "public" / "lines.mjs").read_text(encoding="utf-8"))}

    # Same hop sequence per route in both tabs; join by position and check.
    by_t, by_f = {}, {}
    for r in times:
        by_t.setdefault(r[0], []).append(r)
    for r in fares:
        by_f.setdefault(r[0], []).append(r)
    if set(by_t) != set(by_f):
        sys.exit(f"route sets differ: {sorted(set(by_t) ^ set(by_f))}")

    edges: dict[tuple, dict] = {}
    routes: list[dict] = []          # surveyed routes: hop sequence, AJ total, per-hop field fares
    for rid, hops_t in by_t.items():
        hops_f = by_f[rid]
        route = {"id": rid, "hops": [], "legFares": [], "fare": totals.get(rid)}
        if len(hops_t) != len(hops_f):
            sys.exit(f"{rid}: {len(hops_t)} time hops vs {len(hops_f)} fare hops")
        for t, f in zip(hops_t, hops_f):
            o, d, mode, ttype = str(t[3]).strip(), str(t[4]).strip(), label(t[5]), str(t[6]).strip()
            if (str(f[2]).strip(), str(f[3]).strip()) != (o, d):
                sys.exit(f"{rid}: hop mismatch {o}->{d} vs {f[2]}->{f[3]}")
            if o == d:
                continue  # "Blok M -> Blok M (Selesai)" end marker
            route["hops"].append([o, d, mode])
            minutes = num(t[7]) if ttype != "walk" else None
            if minutes is None:
                if ttype != "walk":
                    print(f"  [skip] {rid}: no minutes for {o} -> {d} ({mode})")
                    continue
                minutes = WALK_MIN
            dist = int(num(f[6]) or 0)
            recorded = None if ttype == "walk" else field_fare(field, rid, o, d, mode)
            fare = recorded if recorded is not None else int(num(f[7]) or 0)
            route["legFares"].append(0 if ttype == "walk" else fare)
            key = (o, d, mode)
            if key in edges:
                # Same hop priced in several routes: keep the tap-in fare so a TJ
                # edge is never free out of context.
                edges[key]["fare"] = max(edges[key]["fare"], fare)
                continue
            edges[key] = {"from": o, "to": d, "route": mode, "mode": ttype,
                          "fare": fare, "time": round(minutes, 2), "dist": dist}
            if ttype == "transjakarta":
                edges[key]["brt"] = re.sub(r"^TJ\s+", "", mode) not in NON_BRT
        if route["fare"] is not None:
            if sum(route["legFares"]) != route["fare"]:
                print(f"  note {rid}: hop fares sum to {sum(route['legFares'])} but AJ says {route['fare']}; AJ wins")
            routes.append(route)

    # Walks that leave the paid area: the field rows show a bus after them pays
    # again. Evidence first; otherwise any walk over 300 m between different
    # stations (a street walk, not a transfer inside one halte).
    paid_after_walk: dict[tuple, bool] = {}
    for rid, hops in field.items():
        if rid not in clean:
            continue
        prev_brt = False
        for i, (titik, moda, harga) in enumerate(hops[:-1]):
            c = classify_mode(moda or "")
            if c == "Walk":
                nxt = hops[i + 1]
                if classify_mode(nxt[1] or "") == "TJ" and nxt[2] is not None and prev_brt:
                    paid_after_walk[(canon(titik), canon(nxt[0]))] = nxt[2] > 0
                continue
            prev_brt = c == "TJ" and re.sub(r"^TJ\s+", "", moda or "") not in NON_BRT
    def hav(a, b):
        la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
        h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
        return 2 * 6371000 * math.asin(math.sqrt(h))
    for e in edges.values():
        if e["mode"] != "walk":
            continue
        a, b = canon(e["from"]), canon(e["to"])
        if (a, b) in paid_after_walk:
            e["open"] = paid_after_walk[(a, b)]
        elif a != b and a in geo and b in geo and hav(geo[a], geo[b]) > 300:
            e["open"] = True

    nodes = sorted({e["from"] for e in edges.values()} | {e["to"] for e in edges.values()})
    stations = sorted({canon(n) for n in nodes})
    out = {
        "meta": {"start": "UI", "end": "Blok M", "transfer_penalty": TRANSFER_PENALTY, "k": 10, "tj_tap_in": TJ_TAP_IN,
                 "source": f"Project Google Sheet: {FIELD_TAB} (field fares), {FARE_TAB} (distance, fallback fare), {TIME_TAB} (minutes); walks {WALK_MIN} min"},
        "stations": stations,  # layout + coordinates: public/lines.mjs
        "nodes": [{"id": n, "station": canon(n)} for n in nodes],
        "edges": list(edges.values()),
        "routes": routes,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT.parent)}: {len(stations)} stations, {len(nodes)} nodes, {len(edges)} edges, {len(routes)} routes with AJ totals, "
          f"{sum(1 for e in edges.values() if e.get('open'))} open walks")


if __name__ == "__main__":
    main(refetch="--refetch" in sys.argv)
