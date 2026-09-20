// Schematic layout in the idiom of the FDTJ "Peta Integrasi Transportasi Umum
// Jakarta": north up, lines as octilinear polylines through their stops,
// official-ish corridor colours. Coordinates are a 900×640 grid chosen by hand
// for legibility, not geography. Only stops present in the OPTG graph appear;
// a leading "~" marks a stop the line passes without the graph using it, and a
// bare [x, y] is a bend waypoint.

export const STATIONS = {
  // Sudirman corridor (MRT + TJ 1), x = 200
  'Fatmawati': [200, 570], 'Blok A': [200, 500], 'Blok M': [200, 440], 'Kejaksaan Agung': [200, 400],
  'Bundaran Senayan': [200, 350], 'Senayan': [200, 310], 'Bendungan Hilir': [200, 210], 'Semanggi': [280, 210],
  'Dukuh Atas': [200, 140], 'Sudirman': [240, 100], 'Galunggung': [250, 140],
  'Kantor Pos Fatmawati': [140, 540], 'CSW': [250, 400],
  // Rasuna Said / Tendean
  'Kuningan': [410, 180], 'Tegal Mampang': [410, 360], 'Hotel Maharadja': [400, 470],
  // Gatot Subroto (TJ 9 + LRT), y = 260
  'Simpang Kuningan': [370, 260], 'Tegal Parang': [470, 260], 'Pancoran': [560, 260], 'Cikoko': [660, 260],
  'Cawang-Sentral': [800, 260],
  // Bogor line, x = 760
  'Cikini': [640, 50], 'Manggarai': [640, 100], 'Tebet': [760, 230], 'Cawang': [760, 320], 'Duren Kalibata': [760, 370],
  'Pasar Minggu': [760, 420], 'Tanjung Barat': [760, 480], 'Stasiun UI': [760, 540], 'Depok Baru': [760, 600],
  'UI': [680, 540], 'SMPN 8': [560, 50],
};

// Real positions for the map view, WGS84 [lat, lon]. Geocoded from
// OpenStreetMap via Nominatim and Overpass (2026-09-17).
export const GEO = {
  'UI': [-6.35244, 106.83243],            // Halte Universitas Indonesia, Lenteng Agung Raya
  'Stasiun UI': [-6.36043, 106.83178], 'Depok Baru': [-6.39113, 106.82169], 'Tanjung Barat': [-6.30804, 106.83895],
  'Pasar Minggu': [-6.28333, 106.84486], 'Duren Kalibata': [-6.25520, 106.85517], 'Cawang': [-6.24255, 106.85869],
  'Cawang-Sentral': [-6.25073, 106.87339], 'Cikoko': [-6.24348, 106.85707], 'Tebet': [-6.22640, 106.85844],
  'Manggarai': [-6.21017, 106.84994], 'Cikini': [-6.19851, 106.84128], 'SMPN 8': [-6.20148, 106.84304],
  'Sudirman': [-6.20252, 106.82364], 'Dukuh Atas': [-6.20080, 106.82279], 'Galunggung': [-6.20440, 106.82342],
  'Kuningan': [-6.22885, 106.83322], 'Simpang Kuningan': [-6.23720, 106.82810], 'Tegal Parang': [-6.23882, 106.83020],
  'Pancoran': [-6.24310, 106.84397], 'Tegal Mampang': [-6.24019, 106.83091], 'Hotel Maharadja': [-6.24028, 106.82513],
  'Semanggi': [-6.22039, 106.81323], 'Bendungan Hilir': [-6.21503, 106.81795], 'Senayan': [-6.22430, 106.80568],
  'Bundaran Senayan': [-6.22799, 106.80079], 'Kejaksaan Agung': [-6.24045, 106.79845],
  'CSW': [-6.23989, 106.79839], 'Blok M': [-6.24444, 106.79812], 'Blok A': [-6.25697, 106.79692],
  'Fatmawati': [-6.29247, 106.79245], 'Kantor Pos Fatmawati': [-6.29441, 106.79504],
};

// Map-view label side where the default (right) would collide with a neighbour.
export const GLABEL = {
  'Simpang Kuningan': 'top', 'Tegal Parang': 'bottom', 'Kejaksaan Agung': 'left', 'CSW': 'right', 'Blok M': 'right',
  'Cikoko': 'top', 'Cawang': 'bottom', 'Cawang-Sentral': 'right', 'Sudirman': 'top', 'Dukuh Atas': 'left', 'Galunggung': 'bottom',
  'UI': 'left', 'Stasiun UI': 'right', 'Kuningan': 'right', 'Tegal Mampang': 'bottom', 'Hotel Maharadja': 'bottom',
  'Senayan': 'left', 'Bundaran Senayan': 'left', 'Semanggi': 'right', 'Bendungan Hilir': 'left', 'SMPN 8': 'top', 'Cikini': 'right',
};

// [dx, dy, text-anchor] relative to the station dot.
export const LABEL = {
  'Fatmawati': [-14, 4, 'end'], 'Blok A': [-14, 4, 'end'], 'Blok M': [-16, 5, 'end'], 'Kejaksaan Agung': [-14, 4, 'end'],
  'Bundaran Senayan': [-14, 4, 'end'], 'Senayan': [-14, 4, 'end'], 'Bendungan Hilir': [-12, 4, 'end'], 'Semanggi': [12, 4, 'start'],
  'Dukuh Atas': [-14, 4, 'end'], 'Sudirman': [12, -6, 'start'], 'Galunggung': [12, 14, 'start'],
  'Kantor Pos Fatmawati': [4, -10, 'middle'], 'CSW': [4, 18, 'middle'],
  'Kuningan': [12, 4, 'start'], 'Tegal Mampang': [12, 4, 'start'], 'Hotel Maharadja': [4, 18, 'middle'],
  'Simpang Kuningan': [4, 18, 'middle'], 'Tegal Parang': [4, 18, 'middle'], 'Pancoran': [4, 18, 'middle'], 'Cikoko': [4, 18, 'middle'],
  'Cawang-Sentral': [0, -12, 'middle'],
  'Cikini': [12, 4, 'start'], 'Manggarai': [12, 4, 'start'], 'Tebet': [12, 4, 'start'], 'Cawang': [12, 4, 'start'], 'Duren Kalibata': [12, 4, 'start'],
  'Pasar Minggu': [12, 4, 'start'], 'Tanjung Barat': [12, 4, 'start'], 'Stasiun UI': [12, 4, 'start'], 'Depok Baru': [12, 4, 'start'],
  'UI': [-16, 5, 'end'], 'SMPN 8': [-12, 4, 'end'],
};

// FDTJ palette, approximated.
export const COLORS = {
  krl_bogor: '#e0262d', krl_cikarang: '#00aeef', mrt: '#1b2a6b', lrt: '#0b7a3b',
  tj1: '#c8102e', tj4: '#3f2a7d', tj6: '#6cb33f', tj7: '#ec008c', tj9: '#00a99d', tj13: '#9b59b6', tjD: '#7f8c8d',
};

// Drawing order: buses first, rail on top. `routes` are the names used in optg.json.
// Stop order comes from the FDTJ map; where a TJ corridor's intermediate routing
// between two graph stops is not in the data (4C, 4K, 6M, 7Q) it follows the
// plausible road and is drawn for shape only.
export const LINES = [
  // Corridor 1 serves Bendungan Hilir. Semanggi is a separate stop reached
  // from Bendungan Hilir by the walking transfer encoded in optg.json.
  { id: '1', color: COLORS.tj1, routes: ['1'], stops: ['Dukuh Atas', 'Bendungan Hilir', 'Senayan', 'Bundaran Senayan', 'Kejaksaan Agung', 'Blok M'] },
  { id: '1P', color: COLORS.tj1, routes: ['1P'], stops: ['Bundaran Senayan', '~Kejaksaan Agung', 'Blok M'] },
  { id: '1E', color: COLORS.tj1, routes: ['1E'], stops: ['Kantor Pos Fatmawati', 'Blok A', 'Blok M'] },   // stops at St. Blok A Petogogan
  { id: '4', color: COLORS.tj4, routes: ['4'], stops: ['Manggarai', [600, 140], [410, 140], 'Galunggung'] },
  { id: '4B', color: COLORS.tj4, routes: ['TJ 4B', '4B'], stops: ['UI', 'Tanjung Barat', 'Pasar Minggu', [700, 380], [700, 200], [640, 140], 'Manggarai'] },
  { id: '4C', color: COLORS.tj4, routes: ['4C'], stops: ['SMPN 8', [600, 140], [410, 140], '~Galunggung', 'Dukuh Atas', 'Bendungan Hilir', '~Senayan', 'Bundaran Senayan'] },   // down Sudirman: Dukuh Atas, Benhil, GBK
  // Approach Kejaksaan Agung from above, clear of CSW and its walking link.
  { id: '4K', color: COLORS.tj4, routes: ['4K'], stops: ['Cikoko', 'Pancoran', 'Tegal Mampang', [240, 360], 'Kejaksaan Agung'] },   // via Rawa Barat and Pasar Santa, not CSW
  { id: '6', color: COLORS.tj6, routes: ['6'], stops: ['~Hotel Maharadja', 'Kuningan', [410, 140], 'Galunggung'] },   // Mampang Prapatan, Rasuna Said; not Tegal Mampang
  { id: '6C', color: COLORS.tj6, routes: ['6C'], stops: ['Tebet', 'Kuningan'] },
  { id: '6D', color: COLORS.tj6, routes: ['6D'], stops: ['Tebet', [640, 210], 'Bendungan Hilir', '~Senayan', 'Bundaran Senayan'] },   // Casablanca, Satrio, Karet, then Sudirman
  { id: '6M', color: COLORS.tj6, routes: ['6M'], stops: ['Manggarai', [600, 140], [410, 140], 'Kuningan', '~Simpang Kuningan', 'Semanggi', 'Senayan', 'Bundaran Senayan', 'Kejaksaan Agung', 'Blok M'] },   // Sudirman, Gatot Subroto, Rasuna Said
  { id: '6T', color: COLORS.tj6, routes: ['6T'], stops: ['Pasar Minggu', [640, 500], 'Blok A'] },
  { id: '6U', color: COLORS.tj6, routes: ['6U'], stops: ['Pasar Minggu', [640, 470], 'Hotel Maharadja', 'Blok M'] },
  { id: '6V', color: COLORS.tj6, routes: ['6V'], stops: ['Tegal Mampang', [240, 360], 'Kejaksaan Agung'] },
  { id: '7B', color: COLORS.tj7, routes: ['7B'], stops: ['Tegal Mampang', [240, 360], 'Kejaksaan Agung', 'Blok M'] },   // via Rawa Barat and Pasar Santa
  { id: '7Q', color: COLORS.tj7, routes: ['7Q'], stops: ['Duren Kalibata', [640, 470], '~Hotel Maharadja', 'Blok M'] },
  { id: '9', color: COLORS.tj9, routes: ['9'], stops: ['Cawang-Sentral', 'Cikoko', 'Pancoran', 'Tegal Parang', 'Simpang Kuningan', 'Semanggi'] },
  { id: '9C', color: COLORS.tj9, routes: ['9C'], stops: ['Cawang-Sentral', 'Cikoko', 'Pancoran', 'Tegal Parang', 'Simpang Kuningan', 'Semanggi', 'Senayan', 'Bundaran Senayan'] },
  { id: '9D', color: COLORS.tj9, routes: ['9D'], stops: ['Pasar Minggu', [640, 360], 'Pancoran', 'Tegal Parang', 'Simpang Kuningan', 'Semanggi'] },
  { id: '13', color: COLORS.tj13, routes: ['13'], stops: ['Tegal Mampang', 'CSW'] },
  { id: '13B', color: COLORS.tj13, routes: ['13B'], stops: ['Pancoran', 'Tegal Mampang', 'CSW'] },
  { id: '13E', color: COLORS.tj13, routes: ['13E'], stops: ['Kuningan', 'Simpang Kuningan', 'Tegal Mampang', 'CSW'] },
  { id: 'D21', color: COLORS.tjD, routes: ['D21', 'TJ D21'], stops: ['UI', 'Tanjung Barat', [720, 520], [640, 600], [230, 600], 'Fatmawati'] },
  { id: 'D11', color: COLORS.tjD, routes: ['D11', 'TJ D11'], stops: ['Depok Baru', [820, 560], [820, 290], 'Cawang-Sentral'] },
  { id: 'LRT', color: COLORS.lrt, rail: true, routes: ['Cibubur Line'], stops: ['Cikoko', 'Pancoran', '~Tegal Parang', 'Kuningan', 'Dukuh Atas'] },
  { id: 'MRT', color: COLORS.mrt, rail: true, routes: ['Bundaran HI - Lebak Bulus', 'Lebak Bulus - Bundaran HI'], stops: ['Fatmawati', 'Blok A', 'Blok M', '~Kejaksaan Agung', '~Bundaran Senayan', '~Senayan', 'Bendungan Hilir', 'Dukuh Atas'] },
  { id: 'Cikarang', color: COLORS.krl_cikarang, rail: true, routes: ['Cikarang Line'], stops: ['Manggarai', 'Sudirman'] },
  { id: 'Bogor', color: COLORS.krl_bogor, rail: true, routes: ['Bogor Line'], stops: ['Depok Baru', 'Stasiun UI', 'Tanjung Barat', 'Pasar Minggu', 'Duren Kalibata', 'Cawang', 'Tebet', 'Manggarai', 'Cikini'] },
];

export const ROUTE_LINE = new Map(LINES.flatMap(l => l.routes.map(r => [r, l])));

/** Real stops `line` passes strictly between a and b (either direction); [] if a or b is not on it. */
export function stopsBetween(line, a, b) {
  const names = line.stops.map(x => Array.isArray(x) ? null : x.replace(/^~/, ''));
  const i = names.indexOf(a), j = names.indexOf(b);
  if (i < 0 || j < 0) return [];
  const step = i < j ? 1 : -1, out = [];
  for (let k = i + step; k !== j; k += step) {
    const x = line.stops[k];
    if (!Array.isArray(x) && !x.startsWith('~')) out.push(names[k]);
  }
  return out;
}

/** Tag every graph edge with the stations its ride passes through, so a closed
 *  station cuts the line, not just the boarding there. */
export function annotateVia(data) {
  const station = new Map(data.nodes.map(n => [n.id, n.station]));
  for (const e of data.edges) {
    const line = ROUTE_LINE.get(e.route);
    e.via = line ? stopsBetween(line, station.get(e.from), station.get(e.to)) : [];
  }
  return data;
}
