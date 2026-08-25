# Self-hosting fork of Norgeskart

Fork of Kartverket's Norgeskart with additions for self-hosting outside the
official cloud. Working branch: `self-host`.

## Deploy

Runs as a Docker Compose stack. The user builds and runs on their host —
**do not run `npm run build` / `tsc` locally**; TypeScript errors surface in
the docker build output instead.

Standard rebuild on the server:

```
git pull
docker compose build --pull norgeskart
docker compose up -d
docker compose logs -f norgeskart wmscache
```

Ports: Caddy inside the container listens on `:3000`; docker-compose maps host
`3030 → container 3000`.

## Services (docker-compose.yml)

- **norgeskart** — multi-stage Dockerfile: `node:24-alpine` builds the SPA,
  then `caddy:2.10.0-alpine` serves `/var/www` with the baked-in `Caddyfile`.
  `config.js` is bind-mounted at runtime.
- **wmscache** — `nginx:1.27-alpine` sidecar. Reverse-proxies +
  caches the Kartverket LiDAR hillshade WMS. Config at
  `nginx/wms-cache.conf`, mounted read-only. Cache lives on a named docker
  volume (`wmscache`) with a 25 GB LRU cap. Not exposed on the host — only
  reachable from `norgeskart` over the compose network.

## Added map content

### Kulturminner (theme layers, Riksantikvaren)

Config: `src/map/layers/config/themeLayers/culturalHeritage.ts`. Registered
in `themeLayerConfigApi.ts` (added to `configs` array) and the layer id
union in `themeWMS.ts` (`CulturalHeritageLayerName`).

Five layers under the "Kulturminner" theme category (groupid 19), one per
Riksantikvaren WMS service on `kart.ra.no`: `kulturminner2` (sites +
monuments), `kulturmiljoer`, `sefrak`, `freda_bygninger`, `brukerminner`.

Feature-info: the category sets `infoFormat: 'application/vnd.ogc.gml'` so
the existing `parseXmlFeatureInfo` (which handles MapServer `msGMLOutput`)
kicks in and shows structured fields. If left unset, the WMS returns HTML,
which the parser wraps as `{ _html: ... }` and the UI shows an
unhelpful "HTML-respons mottatt" placeholder.

CSP: `kart.ra.no` is added to `img-src` and `connect-src` in the Caddyfile.

### LiDAR hillshade (background layer, Kartverket)

Sits in the "Kart" (bottom-right) menu, not "Temakart", because the intent is
to overlay Kulturminner objects on top of the terrain relief.

- Type registered in `src/map/layers/backgroundLayers.ts` (`lidarHillshade`
  in `WMSLayerName`).
- Config: `src/map/layers/config/backgroundLayers/elevation.ts`. Registered
  in `allConfiguredBackgroundLayers` (`atoms.ts`).
- Ordering: entry in `backgroundLayerOrder` in
  `src/map/backgroundLayer/utils.ts`.
- Thumbnail: currently falls back to `topograatone.png` via a case in
  `getBackgroundLayerImageName` in `src/map/atoms.ts`. Drop a real
  `lidarHillshade.png` in `public/backgroundlayerImages/` and remove that
  case when a proper thumbnail is available.
- Translations: `lidarHillshade` added to `backgroundMaps` in
  `src/locales/{nb,nn,en}/translation.json`.

Layer URL is **not** `wms.geonorge.no` directly — the client hits
`/wms/hoyde-dtm`, which Caddy rewrites and proxies to `wmscache`, which
proxies to `https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833`
and caches. This same-origin path avoids CORS issues seen when calling
`wms.geonorge.no` from `fetch()` on the self-host origin.

### Why the LiDAR tile loader is custom

`retryBlankTileLoadFunction` in `src/map/layers/config/backgroundLayers/loadFunctions.ts`
handles a subtle failure mode of the Kartverket DTM WMS: the on-the-fly
renderer occasionally returns a valid HTTP 200 response with a tiny (~479
byte) transparent PNG instead of the real 5–50 KB hillshade. The default
OL error retry doesn't help because there's no error to retry on.

The loader `fetch()`es each tile with `cache: 'no-store'`, checks blob
size, and if under 800 bytes retries up to 3 times with exponential
backoff. After the retry budget is spent, whatever came back is accepted
(legit no-coverage tiles — ocean, Sweden — return the same tiny response
and would loop forever otherwise).

Key CSP dependencies for this path: `img-src` must include `blob:`
(because the loader hands blob URLs to `<img>`).

## nginx cache behavior (wmscache)

`nginx/wms-cache.conf`:

- 25 GB LRU on `/var/cache/nginx/wms`, `inactive=180d`.
- Static upstream block (`server wms.geonorge.no:443; keepalive 8;`) —
  resolved once at startup, so no `resolver` directive needed. Variable-
  based `proxy_pass` caused HTTP 426 responses to leak back to the browser;
  the static form fixes it.
- `Host: wms.geonorge.no` + `proxy_ssl_name` + explicit TLS 1.2/1.3 so the
  handshake with the Kartverket istio-envoy front is unambiguous.
- Skips caching for responses under 1000 bytes (`map` on
  `$upstream_http_content_length`) so blank responses never poison the
  cache. Legit no-coverage tiles are also small and bypass the cache too —
  cheap because they're 479 bytes.
- `proxy_ignore_headers Set-Cookie` — the upstream sends a `JSESSIONID`
  cookie which would otherwise disable caching entirely.
- Adds `X-Cache-Status: HIT|MISS|BYPASS` to responses for debugging.
- `proxy_cache_lock on` — one upstream request in flight per cold key.

Sanity check after a rebuild:

```
curl -sI "http://localhost:3030/wms/hoyde-dtm?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TOPOBATHY_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=256&HEIGHT=256&FORMAT=image/png" | grep -i x-cache
```

First call: `MISS`. Repeat: `HIT`. Inspect on-disk size:
`docker run --rm -v norgeskart_wmscache:/c alpine du -sh /c`.

## Adding another theme layer

1. Create a config file in `src/map/layers/config/themeLayers/`. Export a
   `ThemeLayerConfig` with `categories[]` and `layers[]`. Category holds
   shared defaults (`wmsUrl`, `infoFormat`, `featureInfoFields`, etc.) that
   cascade to layers via `getEffectiveWmsUrl` and the fallback chain in
   `themeWMS.ts`.
2. Import + append to the `configs` array in
   `src/map/layers/themeLayerConfigApi.ts` inside `getThemeLayerConfig()`.
3. Add the layer id(s) to a union in `src/map/layers/themeWMS.ts` and
   into `ThemeLayerName`.
4. Whitelist the WMS host in `Caddyfile` CSP `img-src` (for tiles + legend)
   and `connect-src` (for GetFeatureInfo).
5. If the WMS's GetFeatureInfo doesn't offer JSON, set `infoFormat` on the
   category or layer to a format the parser can handle
   (`application/vnd.ogc.gml` works for MapServer via
   `parseXmlFeatureInfo`).

## Adding another background layer

1. Add id to the appropriate name union in
   `src/map/layers/backgroundLayers.ts`.
2. Create/extend a config in `src/map/layers/config/backgroundLayers/` and
   spread it into `allConfiguredBackgroundLayers` in `atoms.ts`.
3. Add priority in `backgroundLayerOrder` in
   `src/map/backgroundLayer/utils.ts` (controls display order in the
   "Kart" panel).
4. Handle the thumbnail in `getBackgroundLayerImageName` in
   `src/map/atoms.ts` — either add a `public/backgroundlayerImages/<id>.png`
   asset or map to an existing image as a placeholder.
5. Add translations under `map.settings.layers.mapNames.backgroundMaps.<id>`
   in `src/locales/{nb,nn,en}/translation.json`.

## Conventions specific to this fork

- Server-only rebuilds. Do not `npm install` / `tsc` / `npm run build`
  locally; the user's host doesn't carry the build toolchain. Print the
  `docker compose ...` commands they should run.
- Keep unused code out. If a helper (retry function, config field) has no
  live caller after a change, delete it — don't leave it in "for later".
- Commits use short imperative subject lines. Body explains the *why* when
  the reasoning isn't obvious from the diff. The `Co-Authored-By` trailer
  is added by the commit workflow.
