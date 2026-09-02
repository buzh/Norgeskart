# Lokaliteter — design for the user-content model

Status: agreed design, pre-implementation. This replaces the annotations
MVP ("Mine funn" / "Nytt objekt") wholesale; existing `finds` data and
schema are dropped, no migration.

## Framing

The app helps users — individually or collaboratively — discover unknown
cultural-heritage features in LiDAR terrain so they can be reported
upstream (Riksantikvaren) later. The top-level object is therefore **an
area to explore**, not a claim that something archaeological is there.
The real product is a well-documented funn: coordinates, description,
and the imagery that shows why you believe it.

## Vocabulary

| Concept              | UI (nb/nn)  | UI (en)          | Code / PocketBase          |
| -------------------- | ----------- | ---------------- | -------------------------- |
| Top-level area       | lokalitet   | locality         | `localities`, `LocalityRecord`, `localityLayer` |
| Child feature        | funn        | find             | `funn` / finds machinery, now child-level |

Mirrors Riksantikvaren's lokalitet → enkeltminne hierarchy on purpose.
UI wording must keep "your lokaliteter" visually distinct from official
register sites.

## Entity model

```
Lokalitet   — rectangle (authored, not derived), name, description,
              visibility (private | limited | public), owner
 ├─ Funn    — drawn feature: polygon / circle / line / point,
              each individually addressable: label, note, status
 ├─ Bilder  — kept LiDAR extracts, map screenshots, uploads
 └─ (room for more: links, measurements, …)
```

Rules:

- The rectangle is created first (one drag gesture) and can be **resized
  and moved** afterwards.
- A funn belongs to exactly one lokalitet and the lokalitet holds the
  entire extent of its funn (grow the rectangle if needed).
- Funn carry a lifecycle status, e.g. `mulig → sannsynlig → avkreftet →
  rapportert`. Dismissing a false positive is progress; `rapportert`
  closes the loop once upstream reporting exists.
- **Everything is behind sign-in.** No guest browsing of public
  lokaliteter.
- `limited` visibility stays a placeholder until groups/sharing exist;
  its eventual payoff is realtime co-analysis (PB realtime already
  syncs).

## Interaction model

**Browse mode** (no lokalitet open). Map as today: base maps,
Kulturminner theme layers, search. The user's (and visible others')
lokaliteter render as labeled rectangles. TopBar slims down: the
standalone `draw`, `lidarExtract`, `newFind`, `myFinds` buttons are
replaced by **"Ny lokalitet"** and **"Mine lokaliteter"**. Measure stays
global (ephemeral, general-purpose). Clicking a rectangle or a list row
opens its workspace.

**Creation.** "Ny lokalitet" arms the same box-drag interaction the
LiDAR extract uses today. Drag → rectangle lands → workspace panel opens
with the name field focused. Gesture before form.

**Workspace mode.** Docked left panel (successor of the 345px
MapToolCard column in `Layout.tsx`, probably wider). Map stays fully
interactive; the rectangle is framed, outside ideally dimmed slightly.

```
┌──────────────────────────────┐
│ ◀ Tilbake   Navn  [synlighet]│  header: name, description, visibility
├──────────────────────────────┤
│ FUNN                    [+]  │  + arms draw tools; row click →
│  ● Gravhaug? (polygon)       │  highlight/zoom; per-funn label,
│  ● Hulvei    (linje)         │  note, status, edit, delete
├──────────────────────────────┤
│ BILDER                  [+]  │  thumbnails: kept extracts,
│  [img] [img] [img]           │  screenshots, uploads → viewer
├──────────────────────────────┤
│ VERKTØY                      │
│  ✏ Tegn/annoter              │  full DrawControls, lokalitet-scoped
│  ⛰ LiDAR-uttrekk             │  runs against the rectangle; "keep"
│  📷 Skjermbilde              │  puts results under Bilder
└──────────────────────────────┘
```

The two loops:

- *Analyze:* extract runs use the lokalitet's rectangle (no
  re-selection); in the compare viewer, **keep** replaces download-as-
  the-only-exit — kept images become Bilder attachments.
- *Annotate:* `+` under Funn → draw → the shape becomes a named funn
  with its own note and status, not an anonymous stroke in a geometry
  blob.

Drawing and LiDAR extract exist **only** inside a lokalitet workspace;
the path to those tools is creating a lokalitet.

## New capabilities in scope

- **Skjermbilde**: capture the current map view (OL `rendercomplete`
  canvas), cropped to the rectangle, saved as a Bilde. Doesn't exist in
  the codebase today.
- **Keep-extract**: attach stitched extract PNGs to the lokalitet
  instead of (only) downloading.
- **Kulturminner readout**: "known kulturminner within this rectangle"
  via the RA WMS we already proxy/parse — answers "is this already
  registered?" up front.
- **Media storage**: PocketBase file fields / child collection —
  greenfield, nothing exists yet.

## What this removes / heals in the current code

- The shared-drawlayer scratchpad choreography in `NewFindPanel`
  (confirm-discard, hide/unhide persisted find, triple cleanup) —
  drawing always targets the open lokalitet.
- "bbox = union of drawn features" — the boundary is authored.
- Flat-orange rendering of saved geometry — funn keep per-feature style.
- Ephemeral LiDAR extracts.
- `finds` collection + its migrations are superseded (fresh schema; old
  data dropped by agreement).
- TopBar entries `draw` / `lidarExtract` / `newFind` / `myFinds`; the
  `MapTool` union and `MapToolCards` if-chain get restructured around
  the workspace.

## Deferred (explicitly not now)

- Groups / sharing semantics behind `limited`, collaborative editing.
- Upstream reporting flow (export a funn packet for Riksantikvaren).
- Schema detail: per-funn records vs. properties inside a
  FeatureCollection — decide at implementation-planning time, informed
  by per-funn status/notes and realtime granularity.
