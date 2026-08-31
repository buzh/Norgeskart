/// <reference path="../pb_data/types.d.ts" />
//
// Initial annotations schema. Runs once on first pocketbase boot.
//
// 1. Adds a `role` field to the built-in `users` collection.
//    Values: guest / user / admin. Default 'user' on new signups.
//    (Guest is a policy label for signed-out visitors; no user record
//    ever has role='guest' in practice, but keeping it in the enum
//    documents the tier and leaves room for signup-limited invites.)
//
// 2. Creates the `finds` collection — one row per annotation.
//    Row-level rules encode the visibility model:
//      - privat   → only owner sees it.
//      - begrenset→ owner + members of any group they've shared with
//                   (groups don't exist yet; the rule permits it now
//                   so we don't have to rewrite it when they arrive).
//      - offentlig→ every signed-in visitor sees it.
//    Admin always sees everything. `geometry` holds a full GeoJSON
//    FeatureCollection so the drawing tools can round-trip their
//    output verbatim; `bbox` is denormalised for future viewport
//    filtering.
//
// PocketBase migration API pinned to v0.22.x (Dao-based). If we bump
// the PB image, revisit — v0.23+ uses `app.findCollectionByNameOrId`.

migrate(
  (db) => {
    const dao = new Dao(db);

    // --- 1. users.role ---------------------------------------------
    const users = dao.findCollectionByNameOrId('users');
    users.schema.addField(
      new SchemaField({
        system: false,
        id: 'users_role',
        name: 'role',
        type: 'select',
        required: true,
        presentable: false,
        unique: false,
        options: {
          maxSelect: 1,
          values: ['guest', 'user', 'admin'],
        },
      }),
    );
    dao.saveCollection(users);

    // --- 2. finds --------------------------------------------------
    const finds = new Collection({
      id: 'finds',
      name: 'finds',
      type: 'base',
      // Read: public to any signed-in user, owner-only for privat,
      // owner-or-admin for begrenset (until groups land).
      listRule:
        'visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      viewRule:
        'visibility = "public" || owner = @request.auth.id || @request.auth.role = "admin"',
      // Create: must be signed in and can only create for themselves.
      createRule: '@request.auth.id != "" && @request.auth.id = owner',
      // Mutate: owner or admin.
      updateRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      deleteRule:
        'owner = @request.auth.id || @request.auth.role = "admin"',
      schema: [
        new SchemaField({
          id: 'finds_owner',
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
          id: 'finds_title',
          name: 'title',
          type: 'text',
          required: true,
          options: { min: 1, max: 200 },
        }),
        new SchemaField({
          id: 'finds_description',
          name: 'description',
          type: 'text',
          required: false,
          options: { max: 20000 },
        }),
        new SchemaField({
          id: 'finds_visibility',
          name: 'visibility',
          type: 'select',
          required: true,
          options: {
            maxSelect: 1,
            values: ['private', 'limited', 'public'],
          },
        }),
        new SchemaField({
          id: 'finds_geometry',
          name: 'geometry',
          type: 'json',
          required: true,
          // GeoJSON blobs can grow — 5 MB per find is plenty for even
          // detailed hand-drawn polygons. Guardrail, not a target.
          options: { maxSize: 5_000_000 },
        }),
        new SchemaField({
          id: 'finds_bbox',
          name: 'bbox',
          type: 'json',
          required: true,
          // [minLon, minLat, maxLon, maxLat] in EPSG:4326.
          options: { maxSize: 200 },
        }),
      ],
      indexes: [
        'CREATE INDEX idx_finds_owner ON finds (owner)',
        'CREATE INDEX idx_finds_visibility ON finds (visibility)',
      ],
    });
    dao.saveCollection(finds);
  },
  (db) => {
    const dao = new Dao(db);
    try {
      const finds = dao.findCollectionByNameOrId('finds');
      dao.deleteCollection(finds);
    } catch (_) {
      /* already gone */
    }
    try {
      const users = dao.findCollectionByNameOrId('users');
      users.schema.removeField('users_role');
      dao.saveCollection(users);
    } catch (_) {
      /* already gone */
    }
  },
);
