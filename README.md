# TransitLab

Interactive route optimiser for Universitas Indonesia → Blok M. The transit
network (KRL, MRT, LRT Jabodebek, TransJakarta) is a directed weighted graph
with a real fare and Google Maps travel time on every hop. Visitors press
play to watch the best route light up, drag a fare-vs-time weight, and click
any station to close it and see the engine reroute in real time.

Plain HTML, CSS and ES modules. No framework, no build step, no backend. The
only runtime dependency is Leaflet (from cdnjs, with subresource integrity)
and OpenStreetMap tiles for the optional map view. The engine is a port of the graph-theory capstone
notebook (`tgoptggraph.ipynb`), FMIPA Universitas Indonesia.

The schematic follows the logic of the FDTJ *Peta Integrasi Transportasi
Umum Jakarta*: each service is one continuous line through its stops, drawn
only with horizontal, vertical and 45° segments, in its corridor colour;
lines that share a corridor run side by side; interchanges are bold pills.
A route lights up along the lines it actually rides, hop by hop.

## What the maths does

- **Dijkstra** on state (station, arriving mode) with a 5-minute penalty per
  mode change. Keying on the arriving mode keeps the penalty exact.
- **Yen's k-shortest paths** for the 10 best distinct journeys. The line
  graph reaches the same ride through several intermediate-stop edges, so
  paths are deduplicated by journey (which line boarded at which station).
- **Pareto front** on (fare, time), and a score `w·fare + (1−w)·time` on
  min-max normalised values that the slider controls.
- **Criticality** on hover: how many of the 10 routes pass through a station.
  A station on all 10 is a single point of failure.

## Run

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory public
```

Open http://127.0.0.1:8765. Modules need an HTTP server; `file://` will not work.

```powershell
node tests/engine.test.mjs
```

## Layout

`public/lines.mjs` holds the hand-placed station grid and the ordered stop
list per line (KRL Bogor and Cikarang, MRT, LRT Jabodebek, and every
TransJakarta corridor the 64 routes use). A `~name` entry is a stop the line
passes but the graph never boards there; an `[x, y]` entry is a bend. The
renderer inserts the 45° elbows and the parallel offsets itself, so moving a
station or re-ordering a line is a one-line edit. Where a TJ corridor's exact
intermediate routing was not in the data it is drawn along the plausible
road, and marked as such in that file.

## Map view

The **Map** toggle shows the same network, closures and route playback on
OpenStreetMap tiles. Station positions in `GEO` were geocoded from OSM via
Nominatim and Overpass. Lines run straight between consecutive stops rather than tracing the
road, which is honest about what the data holds. OSM's tile usage policy
allows light use like this; swap the tile URL if traffic ever grows.

## Data

`public/data/optg.json` is generated once from the notebook's inputs kept in
`scripts/raw/`: the two public Google Sheet CSVs (64 candidate routes and the
field-collected fares) and the frozen Maps snapshot (fetched 2026-09-11 for a
Monday 11:00 WIB departure). Regenerate with:

```powershell
python scripts/export_graph.py
```

Pass `--refetch` to pull the sheets again first. Station coordinates in the
exporter are hand-nudged for a readable schematic, not survey positions.

## Deploy

Import the folder into Vercel with framework **Other**, no build command and
`public` as the output directory. `vercel.json` already says so.
