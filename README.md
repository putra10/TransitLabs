# TransitLab

Interactive route optimiser for Universitas Indonesia → Blok M. The transit
network (KRL, MRT, LRT Jabodebek, TransJakarta) is a directed weighted graph
with the project spreadsheet's fare, distance and travel time on every hop. Visitors press
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

The site is three pages: the lab (`/`), `/method` (why Blok M and how the
maths works) and `/data` (sources, numbers, files, team). `vercel.json` turns
on `cleanUrls`, so `data.html` is served at `/data`; the dev server mirrors
that, and a plain static server needs the `.html` suffix.
The page is bilingual. Every piece of static copy exists twice in
`index.html` as `<span lang="en">` / `<span lang="id">` pairs and CSS shows
one set; the few dynamic strings live in a small dictionary in `app.js`.
The choice persists in `localStorage` and defaults to Indonesian on a first visit.

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
- **Constraints.** Untick a transport type to drop every ride of that mode;
  add "must pass" stations (or shift-click them) and every journey returned
  stops at or rides through each of them. Yen keeps enumerating until it has
  k journeys that satisfy the constraint, which the small graph affords.
- **Pass-through stations.** A graph edge like Stasiun UI → Manggarai is one
  KRL ride, but the train physically passes Tanjung Barat, Pasar Minggu,
  Duren Kalibata, Cawang and Tebet. Both views draw the hop along the line and
  blink those stations as it goes by. Every edge carries that list, and
  **closing a station cuts the line through it**: with Duren Kalibata closed
  no KRL ride from Stasiun UI can reach Cawang, so the engine falls back to
  the buses. This is the OPTG logic from the capstone graph.

## Run

```powershell
python scripts/serve.py
```

Open http://127.0.0.1:8765. Modules need an HTTP server; `file://` will not
work. The script serves `public/` with caching off.

```powershell
node tests/engine.test.mjs
```

## Layout

`public/lines.mjs` holds the hand-placed station grid and the ordered stop
list per line (KRL Bogor and Cikarang, MRT, LRT Jabodebek, and every
TransJakarta corridor the routes use). A `~name` entry is a stop the line
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

`public/data/optg.json` is generated from the team's project spreadsheet,
kept as `scripts/raw/sheet.xlsx`:

- `Copy of Rute Mentah`: the 64 vetted routes; only these are used.
- `Rute Tabel`: the fares the team paid, matched hop by hop. They are the
  primary fare source. `Sheet12` (the notebook's fare export) only fills a
  hop the field row leaves blank, and supplies distances.
- `Sheet13`: minutes per hop. Walking hops are blank and get 3 minutes.

The engine applies the fare rules the field rows show: a TransJakarta BRT
corridor after another BRT corridor is free, boarding after rail or after a
non-BRT service (4B, D11, D21) pays the flat Rp 3,500, and consecutive KRL
lines are one tap priced by the official tariff on the combined distance.
Replaying all 64 routes this way reproduces the field total for 56; the
other 8 field rows are incomplete or describe an older version of the trip.
Regenerate with:

```powershell
python scripts/export_graph.py
```

Pass `--refetch` to download the workbook again first. The notebook's older
inputs in `scripts/raw/` are kept for reference only.

## Deploy

Import the folder into Vercel with framework **Other**, no build command and
`public` as the output directory. `vercel.json` already says so. Every page
loads `/_vercel/insights/script.js` (Web Analytics) and
`/_vercel/speed-insights/script.js` (Speed Insights); enable both in the
project dashboard and they start reporting after the first visits. Locally
the scripts 404, which is harmless.
