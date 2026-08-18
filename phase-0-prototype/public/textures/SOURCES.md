# Texture sources

- `land-mask.png` — generated locally by `scripts/generate-land-mask.mjs`
  from `world-atlas`'s 110m land topology (see that script for detail).

- `earth-night.jpg`, `earth-water.png` — fetched from
  `vasturiano/three-globe`'s demo assets
  (`https://github.com/vasturiano/three-globe`, `example/img/`), commit at
  time of fetch on the `master` branch. That repository is MIT-licensed;
  the imagery itself is the standard NASA Blue Marble / Black Marble
  city-lights derivative reused across the three.js ecosystem for years —
  not fetched directly from NASA's own Visible Earth site because this
  sandbox's network policy blocks `nasa.gov`/Wikimedia directly but allows
  `raw.githubusercontent.com`.

  **Flag, not a silent build (round 7):** this is a reasonable source for
  continued prototype work, but hasn't been re-verified against NASA's own
  distribution or given a formal attribution pass. Worth doing that — or
  re-fetching directly from NASA Visible Earth on a machine with normal
  internet access — before this goes anywhere near a public or commercial
  release, same caveat already on record for the "MOANA." wordmark
  (`README.md`, "A flag worth reading").
