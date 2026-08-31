# Norgeskart (armchair-archaeology build)

A map viewer tailored for **armchair archaeology on Norwegian public
data**: Riksantikvaren's Kulturminner register (heritage sites, SEFRAK
buildings, protected buildings, cultural environments, user-reported
finds) overlaid on Kartverket's LiDAR hillshade, so terrain relief and
the heritage record can be read together.

Derived from [Kartverket's Norgeskart](https://github.com/kartverket/Norgeskart);
this is a hard fork, not tracking upstream.

## Deploy

Runs as a Docker Compose stack (Caddy-served SPA + `wmscache` nginx
sidecar that caches every external WMS the app hits). Standard rebuild
on the host:

```sh
git pull
docker compose build --pull norgeskart
docker compose up -d
docker compose logs -f norgeskart wmscache
```

Caddy inside the container listens on `:3000`; compose maps host
`3030 → container 3000`.

Runtime config lives in `config.js` (bind-mounted into the container).
Copy `config.example.js` and edit the endpoints. See
[`CLAUDE.md`](CLAUDE.md) for the full deploy and services rundown,
including when to restart `wmscache` and how the WMS proxy paths work.

## Data sources

All same-origin from the browser's point of view — the `wmscache`
nginx sidecar reverse-proxies + caches each upstream:

- **Kulturminner** (theme layers) — `kart.ra.no/wms/*`, via `/wms/ra/*`
- **LiDAR hillshade** and per-project LiDAR (background layers) —
  `wms.geonorge.no/skwms1/*`, via `/wms/geonorge/*`
- **Matrikkel** (cadastral, for property lookup) —
  `testapi.norgeskart.no/v1/*`, via `/wms/testapi/*`

## Licence

MIT — see [`LICENCE`](LICENCE). Upstream copyright by Statens Kartverk
(The Norwegian Mapping Authority) is preserved as required. Web
services from Kartverket and Riksantikvaren are subject to their own
licences (mostly CC-BY 3.0 Norway) and the Norwegian Geodata law.
