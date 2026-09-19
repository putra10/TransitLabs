"""Export the OPTG search graph to public/data/optg.json from the project
spreadsheet.

The team's Google Sheet already holds every route broken into hops:
  Sheet13   route_id, origin, destination, mode, ttype, time_min
  Sheet12   route_id, origin, destination, mode, ttype, dist_m, fare, note
Rows are joined hop by hop, so each graph edge carries the sheet's travel
minutes, distance and fare. Walking hops have no minutes in the sheet and
get WALK_MIN. Station aliases collapse raw stop names onto display stations.

    python scripts/export_graph.py            # reads scripts/raw/sheet.xlsx
    python scripts/export_graph.py --refetch  # download the workbook again first
"""
from __future__ import annotations

import json
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
TIME_TAB, FARE_TAB = "Sheet13", "Sheet12"

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
    wb = openpyxl.load_workbook(xlsx, read_only=True)
    times, fares = rows(wb[TIME_TAB]), rows(wb[FARE_TAB])

    # Same hop sequence per route in both tabs; join by position and check.
    by_t, by_f = {}, {}
    for r in times:
        by_t.setdefault(r[0], []).append(r)
    for r in fares:
        by_f.setdefault(r[0], []).append(r)
    if set(by_t) != set(by_f):
        sys.exit(f"route sets differ: {sorted(set(by_t) ^ set(by_f))}")

    edges: dict[tuple, dict] = {}
    for rid, hops_t in by_t.items():
        hops_f = by_f[rid]
        if len(hops_t) != len(hops_f):
            sys.exit(f"{rid}: {len(hops_t)} time hops vs {len(hops_f)} fare hops")
        for t, f in zip(hops_t, hops_f):
            o, d, mode, ttype = str(t[3]).strip(), str(t[4]).strip(), label(t[5]), str(t[6]).strip()
            if (str(f[2]).strip(), str(f[3]).strip()) != (o, d):
                sys.exit(f"{rid}: hop mismatch {o}->{d} vs {f[2]}->{f[3]}")
            if o == d:
                continue  # "Blok M -> Blok M (Selesai)" end marker
            minutes = num(t[7]) if ttype != "walk" else None
            if minutes is None:
                if ttype != "walk":
                    print(f"  [skip] {rid}: no minutes for {o} -> {d} ({mode})")
                    continue
                minutes = WALK_MIN
            fare, dist = int(num(f[7]) or 0), int(num(f[6]) or 0)
            key = (o, d, mode)
            if key in edges:
                # Same hop priced in several routes: keep the tap-in fare so a TJ
                # edge is never free out of context.
                edges[key]["fare"] = max(edges[key]["fare"], fare)
                continue
            edges[key] = {"from": o, "to": d, "route": mode, "mode": ttype,
                          "fare": fare, "time": round(minutes, 2), "dist": dist}

    nodes = sorted({e["from"] for e in edges.values()} | {e["to"] for e in edges.values()})
    stations = sorted({canon(n) for n in nodes})
    out = {
        "meta": {"start": "UI", "end": "Blok M", "transfer_penalty": TRANSFER_PENALTY, "k": 10,
                 "source": f"Project Google Sheet, tabs {TIME_TAB} (minutes) and {FARE_TAB} (distance, fare); walks {WALK_MIN} min"},
        "stations": stations,  # layout + coordinates: public/lines.mjs
        "nodes": [{"id": n, "station": canon(n)} for n in nodes],
        "edges": list(edges.values()),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT.parent)}: {len(stations)} stations, {len(nodes)} nodes, {len(edges)} edges, {len(by_t)} routes")


if __name__ == "__main__":
    main(refetch="--refetch" in sys.argv)
