/// <reference path="../pb_data/types.d.ts" />
//
// Lokaliteter schema — replaces the flat annotations MVP.
// Design: docs/lokaliteter-design.md. The old `finds` collection (one
// geometry blob per record) is dropped WITH its data (agreed — MVP test
// data only) and rebuilt as a child of the new `localities` collection.
//
// 1. `localities` — the top-level "area to explore": an authored
//    rectangle (bbox), name, description, visibility. Same visibility
//    model as the old finds (privat/begrenset/offentlig; begrenset
//    still behaves as privat until groups exist).
//
// 2. `finds` — child records: one per funn the user marks inside a
//    lokalitet. Carries its own title/note and a lifecycle status
//    (mulig → sannsynlig → avkreftet → rapportert). Geometry is a
//    GeoJSON FeatureCollection (EPSG:4326) so the draw tools round-trip
//    verbatim; usually one shape, but a funn may be several strokes.
//    Read access follows the parent lokalitet's visibility via
//    relation traversal in the rules.
//
// 3. `attachments` — bilder: kept LiDAR extracts, map screenshots and
//    uploads. `file` is a protected file field — private lokaliteter
//    must not have world-readable image URLs, so the client fetches
//    short-lived file tokens (see src/api/attachments.ts).
//
// PocketBase migration API pinned to v0.22.x (Dao-based). No ES2021
// numeric separators — Goja / PB jsvm rejects them.

migrate(
  (db) => {
    const dao = new Dao(db);
    const users = dao.findCollectionByNameOrId('users');

    // --- 0. drop the MVP finds collection (data intentionally lost) --
    try {
      const oldFinds = dao.findCollectionByNameOrId('finds');
      dao.deleteCollection(oldFinds);
    } catch (_) {
      /* fresh install — never existed */
    }

    // --- 1. localities ----------------------------------------------
    const localities = new Collection({
      id: 'localities',
      name: 'localities',
      type: 'base',
      listRule:
        'visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      viewRule:
        'visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      createRule: '@request.auth.id != "" && @request.auth.id = owner',
      updateRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      schema: [
        new SchemaField({
          id: 'loc_owner',
          name: 'owner',
          type: 'relation',
          required: true,
          options: {
            collectionId: users.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1,
          },
        }),
        new SchemaField({
          id: 'loc_name',
          name: 'name',
          type: 'text',
          required: true,
          options: { min: 1, max: 200 },
        }),
        new SchemaField({
          id: 'loc_description',
          name: 'description',
          type: 'text',
          required: false,
          options: { max: 20000 },
        }),
        new SchemaField({
          id: 'loc_visibility',
          name: 'visibility',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['private', 'limited', 'public'],
          },
        }),
        new SchemaField({
          id: 'loc_bbox',
          name: 'bbox',
          type: 'json',
          required: true,
          // [minLon, minLat, maxLon, maxLat] in EPSG:4326 — the authored
          // rectangle, resizable/movable, not derived from content.
          options: { maxSize: 200 },
        }),
      ],
      indexes: [
        'CREATE INDEX idx_localities_owner ON localities (owner)',
        'CREATE INDEX idx_localities_visibility ON localities (visibility)',
      ],
    });
    dao.saveCollection(localities);

    // --- 2. finds (child level) -------------------------------------
    // Collection *name* stays `finds`; the id differs from the deleted
    // MVP collection's so nothing can conflate the two schemas.
    const finds = new Collection({
      id: 'finds2',
      name: 'finds',
      type: 'base',
      listRule:
        'locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      viewRule:
        'locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      // Only the lokalitet's owner adds funn to it (collaboration is a
      // later, deliberate rule change).
      createRule:
        '@request.auth.id != "" && @request.auth.id = owner && locality.owner = @request.auth.id',
      updateRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      schema: [
        new SchemaField({
          id: 'find_locality',
          name: 'locality',
          type: 'relation',
          required: true,
          options: {
            collectionId: localities.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1,
          },
        }),
        new SchemaField({
          id: 'find_owner',
          name: 'owner',
          type: 'relation',
          required: true,
          options: {
            collectionId: users.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1,
          },
        }),
        new SchemaField({
          id: 'find_title',
          name: 'title',
          type: 'text',
          required: true,
          options: { min: 1, max: 200 },
        }),
        new SchemaField({
          id: 'find_note',
          name: 'note',
          type: 'text',
          required: false,
          options: { max: 20000 },
        }),
        new SchemaField({
          id: 'find_status',
          name: 'status',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['mulig', 'sannsynlig', 'avkreftet', 'rapportert'],
          },
        }),
        new SchemaField({
          id: 'find_geometry',
          name: 'geometry',
          type: 'json',
          required: true,
          options: { maxSize: 5000000 },
        }),
      ],
      indexes: [
        'CREATE INDEX idx_finds_locality ON finds (locality)',
        'CREATE INDEX idx_finds_owner ON finds (owner)',
      ],
    });
    dao.saveCollection(finds);

    // --- 3. attachments ----------------------------------------------
    const attachments = new Collection({
      id: 'attachments',
      name: 'attachments',
      type: 'base',
      listRule:
        'locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      viewRule:
        'locality.visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      createRule:
        '@request.auth.id != "" && @request.auth.id = owner && locality.owner = @request.auth.id',
      updateRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      schema: [
        new SchemaField({
          id: 'att_locality',
          name: 'locality',
          type: 'relation',
          required: true,
          options: {
            collectionId: localities.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1,
          },
        }),
        new SchemaField({
          id: 'att_owner',
          name: 'owner',
          type: 'relation',
          required: true,
          options: {
            collectionId: users.id,
            cascadeDelete: true,
            minSelect: 1,
            maxSelect: 1,
          },
        }),
        new SchemaField({
          id: 'att_kind',
          name: 'kind',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['extract', 'screenshot', 'upload'],
          },
        }),
        new SchemaField({
          id: 'att_file',
          name: 'file',
          type: 'file',
          required: true,
          options: {
            maxSelect: 1,
            // Stitched extracts of a big lokalitet can be hefty PNGs.
            maxSize: 20000000,
            mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            thumbs: ['200x200', '800x0'],
            protected: true,
          },
        }),
        new SchemaField({
          id: 'att_caption',
          name: 'caption',
          type: 'text',
          required: false,
          options: { max: 500 },
        }),
        new SchemaField({
          id: 'att_meta',
          name: 'meta',
          type: 'json',
          required: false,
          // Extracts store {sourceKey, sourceLabel, style, metresPerPx,
          // bbox25833} so the gallery can say what an image shows.
          options: { maxSize: 10000 },
        }),
      ],
      indexes: [
        'CREATE INDEX idx_attachments_locality ON attachments (locality)',
        'CREATE INDEX idx_attachments_owner ON attachments (owner)',
      ],
    });
    dao.saveCollection(attachments);
  },
  (db) => {
    const dao = new Dao(db);
    for (const name of ['attachments', 'finds', 'localities']) {
      try {
        dao.deleteCollection(dao.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
    // The MVP `finds` collection is not resurrected on rollback — its
    // data was dropped deliberately and its schema lives in
    // 1700000000_finds_and_roles.js for fresh installs.
  },
);
