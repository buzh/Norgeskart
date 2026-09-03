# Norgeskart — armchair-archaeology build

Map viewer tailored for reading Norwegian LiDAR terrain against the
Riksantikvaren heritage register (Kulturminner). Hard fork of
Kartverket's Norgeskart — not tracking upstream. Working branch:
`self-host` (deploy shape, not the project's purpose).

Feature scope is deliberately narrow: keep what an amateur reading
relief-shaded terrain against the heritage record needs (Kulturminner
theme layers, LiDAR hillshade + per-project LiDAR backgrounds, LiDAR
tile extract, drawing, place/property search), drop the rest. If
you're tempted to re-add an upstream Norgeskart feature, ask whether
this specific use case needs it before wiring it back in.

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

If `nginx/wms-cache.conf` or `nginx/wms-proxy-common.conf` changed, also
restart wmscache — the configs are bind-mounted, so the file on disk is
current, but nginx only reads config at startup and `docker compose up -d`
doesn't recreate wmscache (its image tag is unchanged):

```
docker compose restart wmscache
```

Symptom of forgetting this: same-origin proxy paths (e.g. `/wms/ra/...`)
return nginx's default 404 page even though the Caddyfile and layer configs
look correct.

Same class of gotcha for **pocketbase**: `pocketbase/pb_migrations/` is
bind-mounted, but PB only applies migrations at startup, and
`docker compose up -d` doesn't recreate the container (image unchanged).
After adding/changing a migration:

```
docker compose restart pocketbase
docker compose logs pocketbase   # confirm the migration applied
```

Symptom of forgetting this: API calls against the new/changed collection
404, which the SPA may surface only in the browser console (e.g. "Ny
lokalitet" appearing to do nothing).

Ports: Caddy inside the container listens on `:3000`; docker-compose maps host
`3030 → container 3000`.

## Services (docker-compose.yml)

- **norgeskart** — multi-stage Dockerfile: `node:24-alpine` builds the SPA,
  then `caddy:2.10.0-alpine` serves `/var/www` with the baked-in `Caddyfile`.
  `config.js` is bind-mounted at runtime.
- **pocketbase** — annotations backend for the "Mine funn" feature. Small
  in-repo Dockerfile that pins a PocketBase release from GitHub. Serves the
  SPA's `/pb/*` API (auth, `finds` collection, realtime). SQLite state on
  the `pbdata` volume; schema versioned in `pocketbase/pb_migrations/`.
  First-run setup: hit `http://<host>:3030/pb/_/` to create the admin, then
  enable OAuth providers under Settings → Auth providers (Google, GitHub,
  Microsoft, generic OIDC…). To grant admin app-role (distinct from PB
  admin), edit the users record and set `role = "admin"`.
- **wmscache** — `nginx:1.27-alpine` sidecar. Reverse-proxies + caches
  every external WMS the SPA uses. Currently fronts three upstreams:
  - `wms.geonorge.no/skwms1/*` — Kartverket theme + LiDAR WMS.
  - `kart.ra.no/wms/*` — Riksantikvaren Kulturminner WMS.
  - `testapi.norgeskart.no/v1/*` — matrikkel (cadastral) WMS.

  Caddy exposes each host under a same-origin prefix and rewrites into
  the upstream namespace before forwarding:

  ```
  /wms/geonorge/wms.foo    →  wms.geonorge.no/skwms1/wms.foo
  /wms/ra/kulturminner2    →  kart.ra.no/wms/kulturminner2
  /wms/testapi/matrikkel   →  testapi.norgeskart.no/v1/matrikkel
  ```

  Cache config at `nginx/wms-cache.conf` (per-upstream `location` blocks)
  + `nginx/wms-proxy-common.conf` (shared cache/timeout/header defaults).
  Cache lives on the `wmscache` docker volume with a 25 GB LRU cap. Not
  exposed on the host — only reachable from `norgeskart` over the compose
  network.

  Because everything is same-origin from the browser's POV, none of these
  hosts need to appear in the Caddyfile CSP `img-src` / `connect-src`.

## Added map content

### Kulturminner (theme layers, Riksantikvaren)

Config: `src/map/layers/config/themeLayers/culturalHeritage.ts`. Registered
in `themeLayerConfigApi.ts` (added to `configs` array) and the layer id
union in `themeWMS.ts` (`CulturalHeritageLayerName`).

Five layers under the "Kulturminner" theme category (groupid 19), one per
Riksantikvaren WMS service. URLs are same-origin (`/wms/ra/<name>`) and
routed through `wmscache` to `kart.ra.no/wms/<name>`: `kulturminner2`
(sites + monuments), `kulturmiljoer`, `sefrak`, `freda_bygninger`,
`brukerminner`.

Feature-info: the category sets `infoFormat: 'application/vnd.ogc.gml'` so
the existing `parseXmlFeatureInfo` (which handles MapServer `msGMLOutput`)
kicks in and shows structured fields. If left unset, the WMS returns HTML,
which the parser wraps as `{ _html: ... }` and the UI shows an
unhelpful "HTML-respons mottatt" placeholder.

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
`/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833`, which Caddy proxies to
`wmscache`, which proxies to
`https://wms.geonorge.no/skwms1/wms.hoyde-dtm-nhm-topobathy-25833` and
caches. This same-origin path avoids CORS issues seen when calling
`wms.geonorge.no` from `fetch()` on the self-host origin. Same treatment
for the per-project LiDAR at `/wms/geonorge/wms.hoyde-dtm-prosjekt` (see
`lidarProjects.ts`).

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

### Background swaps are gapless

`swapBackgroundLayers` in `backgroundLayers/utils.ts` adds the incoming
layers and removes the outgoing ones only on the next map
`rendercomplete` (8 s timeout as a backstop). Switching LiDAR style or
project rebuilds the whole stack, and the topo base underneath comes
back from cache long before the new hillshade tiles do — tearing down
first meant every step of a W/S or A/D cycle flashed topo. For the same
reason the incoming topo base is inserted at the *bottom* of the layer
collection rather than added on top.

### Keyboard cycling of the LiDAR pulldowns

`TopBar.tsx` binds A/D to the style pulldown and W/S to the dataset
pulldown, top-tier entries only (i.e. not what's behind "flere
stiler"/"mindre relevante"), wrapping at both ends. Neither opens a
pulldown — cycling should leave the terrain unobstructed, which also
means no footprint polygons.

That splits what used to be one flag in two:
`lidarPickerOpenAtom` decides whether footprints are *drawn*, while
`lidarCyclingAtom` (armed by W/S, expires 90 s after the last press or
on leaving LiDAR mode) keeps the viewport list *fetched*. The project
ring is that list, so the first W/S press after a pause only starts the
WFS fetch — the dataset chip shows a spinner meanwhile — and the next
press walks it.

## nginx cache behavior (wmscache)

Split across two files:

- `nginx/wms-cache.conf` — shared cache zone, `$skip_cache` map, one
  `upstream` block per host, and one `location` per host with the
  per-host bits (`proxy_pass`, `Host`, `proxy_ssl_name`).
- `nginx/wms-proxy-common.conf` — everything host-independent: cache
  directives, timeouts, TLS 1.2/1.3, header scrubbing. Included from
  each `location`.

Notes on shared behavior:

- Single 25 GB LRU on `/var/cache/nginx/wms`, `inactive=180d`, shared
  across all three upstreams. The cache key is the full request URI,
  which starts with a unique per-upstream prefix (`/skwms1/`, `/wms/`,
  `/v1/`) so there's no risk of collision.
- Static upstream blocks (`server host:443; keepalive 8;`) — resolved
  once at startup, so no `resolver` directive needed. Variable-based
  `proxy_pass` previously caused HTTP 426 responses to leak back to the
  browser; the static form fixes it.
- Per-host `Host` + `proxy_ssl_name` set inline in each `location`, plus
  explicit TLS 1.2/1.3 in the common include, so the handshake with each
  upstream (Kartverket istio-envoy, RA MapServer, etc.) is unambiguous.
- Skips caching for responses under 1000 bytes (`map` on
  `$upstream_http_content_length`) so blank responses never poison the
  cache. Legit no-coverage tiles are also small and bypass the cache too —
  cheap because they're 479 bytes.
- `proxy_ignore_headers Set-Cookie Cache-Control Expires` — upstreams
  frequently set session cookies which would otherwise disable caching
  entirely.
- Adds `X-Cache-Status: HIT|MISS|BYPASS` to responses for debugging.
- `proxy_cache_lock on` — one upstream request in flight per cold key.

Sanity check after a rebuild (LiDAR hillshade):

```
curl -sI "http://localhost:3030/wms/geonorge/wms.hoyde-dtm-nhm-topobathy-25833?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=NHM_DTM_TOPOBATHY_25833:skyggerelieff&CRS=EPSG:25833&BBOX=200000,6500000,300000,6600000&WIDTH=256&HEIGHT=256&FORMAT=image/png" | grep -i x-cache
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
4. Route requests through `wmscache` instead of hitting the origin from
   the browser. Add a `handle_path /wms/<host-slug>/*` block in
   `Caddyfile` that rewrites to the upstream's WMS path prefix, plus an
   `upstream` + `location` pair in `nginx/wms-cache.conf`, and use
   `/wms/<host-slug>/...` as `wmsUrl` in the config. This gives you the
   25 GB LRU disk cache and same-origin browser requests for free (no
   CSP entry needed).
5. If the WMS's GetFeatureInfo doesn't offer JSON, set `infoFormat` on the
   category or layer to a format the parser can handle
   (`application/vnd.ogc.gml` works for MapServer via
   `parseXmlFeatureInfo`).

## Annotations (Mine funn)

Users can sign in via OIDC and save "finds" — geometry + title + description
with a visibility flag (private / limited / public). The feature is split
across two MapTool panels (`myFinds` and `newFind`) plus a dedicated
`findsLayer` VectorLayer added to the map.

Key files:

- `src/api/pocketbase.ts` — singleton PB client (`pocketbaseUrl` from env,
  defaults `/pb`).
- `src/api/finds.ts` — CRUD + realtime for the `finds` collection.
- `src/auth/` — atoms (currentUserAtom, roleAtom, isAdminAtom), hooks
  (useOAuthProviders, useSignIn, useSignOut), AuthButton + AuthDialog.
- `src/finds/` — MyFindsPanel, NewFindPanel, findsLayer (adds a
  VectorLayer with id `findsLayer` to the map, hydrates from PB, keeps
  it in sync via PB realtime).
- `pocketbase/pb_migrations/1700000000_finds_and_roles.js` — schema.

Data model (finds collection):

- `owner` (relation → users, cascade delete)
- `title` (text, required)
- `description` (text, optional)
- `visibility` ('private' | 'limited' | 'public')
- `geometry` (json — always a GeoJSON FeatureCollection in EPSG:4326)
- `bbox` (json — [minLon, minLat, maxLon, maxLat] in EPSG:4326)

Rules (server-enforced by PB):

- read: `visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"`
- create: signed in, must own the record
- update/delete: owner or admin

Adding an OAuth provider: PB admin UI → Settings → Auth providers. No
code change needed — the SPA's AuthDialog lists whatever the admin has
enabled via `pb.collection('users').listAuthMethods()`.

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
