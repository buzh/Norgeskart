# Lokaliteter — implementation plan

Companion to `lokaliteter-design.md` (the what/why). This is the how:
stages, files, and the seams in the current code each stage replaces.
Each stage is independently buildable and deployable
(`docker compose build --pull norgeskart && docker compose up -d`);
TypeScript errors surface in the docker build, never locally.

## Schema decision (locked for stage 1)

Three collections, funn as first-class child records (not properties
inside one FeatureCollection blob) — needed for per-funn status/notes,
realtime granularity, and eventual collaboration:

- **`localities`** — `owner` (relation users, cascade), `name` (text
  1–200), `description` (text ≤20000), `visibility` (select
  private/limited/public), `bbox` (json, `[minLon,minLat,maxLon,maxLat]`
  EPSG:4326 — the authored rectangle, not derived). Rules: same shape as
  today's finds rules (public ∨ owner ∨ admin-role for read; signed-in
  self-create; owner-or-admin mutate).
- **`finds`** — reuses the collection name at its new child level.
  `locality` (relation localities, cascade), `owner` (denormalized for
  cheap rules), `title`, `note` (text), `status` (select
  mulig/sannsynlig/avkreftet/rapportert, default mulig), `geometry`
  (json FeatureCollection, EPSG:4326 — usually one shape, but a funn may
  be several strokes; keeps the Circle→64-gon round-trip machinery).
  Read rule traverses the parent: `locality.visibility = "public" ||
  owner = @request.auth.id || @request.auth.role = "admin"`.
- **`attachments`** — `locality` (relation, cascade), `owner`, `kind`
  (select extract/screenshot/upload), `file` (PB file field, images,
  ~20 MB cap), `caption` (text), `meta` (json: source key/label, style,
  metresPerPx, bbox — for extracts). Same rule shape as finds.

Migration: **new** file (e.g. `1700000200_localities.js`) that deletes
the old `finds` collection (data dropped by agreement) and creates the
three above. Keep the two existing migration files untouched so fresh
installs replay cleanly in order. Same Dao-based v0.22 API, no ES2021
numeric separators (Goja).

## Stage 1 — backend + API layer

- `pocketbase/pb_migrations/1700000200_localities.js` as above.
- `src/api/localities.ts`: `LocalityRecord`, `LocalityBbox`, CRUD
  (`listLocalities` — keep the 200-cap fix in mind: use `getFullList`
  or paginate), `subscribeLocalities`.
- Rewrite `src/api/finds.ts` for the child level: `FindRecord` gains
  `locality`, `note`, `status`; drops `visibility`/`bbox` (inherited /
  derivable); `listFindsForLocality(localityId)`, CRUD,
  `subscribeFinds` unchanged in shape.
- `src/api/attachments.ts`: `AttachmentRecord`, `createAttachment`
  (FormData with blob), `listAttachmentsForLocality`, delete,
  subscribe; `pb.files.getUrl` helper for thumbnails.

Deployable: yes (dead code until stage 3 wires UI; PB migration runs on
`docker compose up -d` of the pocketbase service).

## Stage 2 — map layers + core state

- `src/localities/atoms.ts`: `activeLocalityAtom` (LocalityRecord |
  null — drives workspace mode), `localityDraftAtom` (rectangle being
  created/edited), plus list-refresh plumbing.
- `src/localities/localityLayer.ts` (successor of
  `src/finds/findsLayer.ts`, same module-level `getLayer` pattern):
  renders every visible locality as a labeled rectangle
  (`polygonFromExtent` of bbox, name as `Text` style). Hydrate via
  `listLocalities`, sync via `subscribeLocalities`, re-hydrate on
  `user?.id` change. Signed-out: layer stays empty (everything behind
  sign-in).
- `src/localities/funnLayer.ts`: features of the **open** locality
  only, hydrated per `activeLocalityAtom`, styled from each feature's
  saved draw-style properties (fixes today's flat-orange rendering).
  `__findId` round-trip property kept.
- Click handling: map click on a locality rectangle (signed in, no
  workspace open) → set `activeLocalityAtom`. Extend
  `useFeatureInfoClick` or a dedicated OL click listener on the layer.

## Stage 3 — TopBar + workspace shell (the big cutover)

- `src/Layout.tsx`: `MapTool` union shrinks to
  `'layers' | 'measure' | 'localities' | null`. The workspace is NOT a
  MapTool — it's driven by `activeLocalityAtom`, so map-tool cards and
  the workspace can't fight over one slot. When a locality is open, the
  left column renders `LocalityWorkspace` instead of
  `SearchComponent`+`MapToolCards`; widen the column for workspace mode
  (`md: 400px, lg: 440px`).
- `src/TopBar.tsx`: remove the `draw`, `lidarExtract`, `myFinds`,
  `newFind` buttons (and their dividers); keep Standard/LiDAR/
  Kulturminner/layers/Flyfoto/Measure. Add signed-in-only "Ny lokalitet"
  (`add_location_alt`) and "Mine lokaliteter" (`bookmark`).
- `src/localities/LocalitiesPanel.tsx` (MapTool `'localities'`): list
  rows (name, visibility badge, updated) → click zooms to bbox and
  opens the workspace. Admin mine/all toggle carried over from
  MyFindsPanel.
- `src/localities/LocalityWorkspace.tsx`: header (back, name,
  description, visibility select) + Funn / Bilder / Verktøy sections
  per the design doc mockup. First cut may stub Bilder.
- "Ny lokalitet": box-drag using the `createBox()` Draw pattern from
  `src/lidarExtract/useDrawSelection.ts` (generalize that hook into
  `src/map/useBoxDraw.ts` so lidarExtract and locality-create share
  it) → `createLocality` with default name → workspace opens, name
  focused.
- Rectangle frame on map while open: dim outside via a big
  world-polygon-with-hole feature on a frame layer, rectangle stroked.
- Delete now-dead code: `src/finds/MyFindsPanel.tsx`,
  `NewFindPanel.tsx`, `editingFindIdAtom`, `setFindHiddenOnLayer` and
  the confirm/hide/restore choreography, the `myFinds`/`newFind`
  branches in `MapToolCards.tsx`, related translation keys (new keys
  under `localities.*`).

Deployable: yes — this is the visible cutover; old finds UI gone.

## Stage 4 — funn creation/editing in the workspace

- "+ Funn" arms `DrawControls` (embedded in Verktøy, as NewFindPanel
  already does) targeting the shared draw layer; a slim save row
  (title, note, status) serializes via the existing
  `serializeDrawLayer` logic (move it to `src/localities/serialize.ts`;
  keep Circle→polygon + export-props handling) → `createFind` with
  `locality` id → clear draw layer → funnLayer upserts.
- Containment: if the drawn extent exceeds the rectangle, offer
  one-click "grow lokalitet to fit" (update bbox) rather than blocking.
- Edit funn: seed draw layer from the single record, hide it on
  funnLayer while editing — same mechanics as today but scoped to one
  small record instead of the whole blob; cancel path stays trivial.
- Funn list rows: click → highlight + zoom; status chip cycles or
  small select; delete with confirm.
- Rectangle resize/move: `ol/interaction/Translate` for move + corner
  `Modify` constrained to keep the geometry rectangular (write the
  constraint by hand; do not pull in ol-ext just for Transform) —
  active only in an explicit "juster område" mode from the header.
- Remove the legacy draw-persistence path once drawing is
  lokalitet-only: `saveFeatures`/`getFeatures` + `?drawing=` handling
  in `src/api/nkApiClient.ts` / `MapComponent.tsx` /
  `DrawControlsFooter.tsx` (per the keep-unused-code-out convention).
  Keep GeoJSON/GPX/GML export — it moves into the workspace.

## Stage 5 — LiDAR extract as a workspace tool + Bilder

- Verktøy → "LiDAR-uttrekk" seeds `lidarExtractSelectionAtom` from the
  locality bbox (compute bboxMap/bbox25833/bboxLonLat with
  `transformExtent` — the atom already carries all three CRSes) and
  opens the existing panel flow inline; no manual box drag inside a
  workspace.
- `LidarExtractViewer.tsx`: add **"Behold"** next to download —
  `canvas.toBlob` → `createAttachment(kind: 'extract', meta: {source,
  style, metresPerPx, bbox25833})`.
- Bilder section: thumbnail grid from `listAttachmentsForLocality`
  (PB thumb URLs), click → simple full-size viewer, upload button
  (`kind: 'upload'`), delete.

## Stage 6 — skjermbilde + kulturminner readout

- `src/localities/screenshot.ts`: on `map.once('rendercomplete')`,
  composite visible layer canvases (standard OL export recipe), crop to
  the locality rectangle in pixel space → blob →
  `createAttachment(kind: 'screenshot')`. CSP: canvas readback is
  same-origin-safe because all tiles already come via the same-origin
  `/wms/*` proxies — verify no remaining cross-origin image source
  taints the canvas.
- "Kjente kulturminner her": query the RA services for features inside
  the rectangle. Investigate first: kart.ra.no is MapServer, so WFS
  `GetFeature` with `BBOX` against the same host likely works through
  a new `handle_path /wfs/ra/*` (or reuse `/wms/ra/` if the path
  allows) — needs a capabilities check. Fallback: grid of
  GetFeatureInfo probes via the existing `parseXmlFeatureInfo` path.
  Render as a compact list in the workspace header area.

## Stage 7 — polish pass

- Viewport-filtered locality loading if lists grow (bbox exists for
  this), empty states, mobile layout for the workspace (reuse the
  collapse pattern from `drawPanelCollapsedAtom`), nn/en translations
  complete, delete any helper left without a live caller.

## Flags / to confirm along the way

- "Everything behind sign-in" is implemented as: all lokalitet content
  invisible to guests (layer empty, buttons hidden — as today). The
  map itself stays publicly browsable. Say the word if you want a full
  auth wall instead.
- Rectangle-constrained Modify is the one genuinely fiddly OL bit in
  stage 4; if it fights back, fallback is "redraw rectangle" (delete +
  re-drag) which is acceptable UX for v1.
- WFS availability on kart.ra.no (stage 6) is unverified — check
  GetCapabilities before building on it.
