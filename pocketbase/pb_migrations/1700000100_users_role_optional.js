/// <reference path="../pb_data/types.d.ts" />
//
// Fix: relax users.role so PocketBase's OAuth auto-provisioning can
// create records. PB populates only its known fields on OAuth signup
// (email, name, avatar, verified); our added `role` had no default,
// so `required: true` caused every first-time OAuth login to fail
// with a generic 400 "Failed to authenticate".
//
// The frontend (`roleAtom`) already treats a missing role as 'user',
// so nullable + no default is the intended behaviour.

migrate(
  (db) => {
    const dao = new Dao(db);
    const users = dao.findCollectionByNameOrId('users');
    const field = users.schema.getFieldById('users_role');
    if (field) {
      field.required = false;
      dao.saveCollection(users);
    }
  },
  (db) => {
    const dao = new Dao(db);
    const users = dao.findCollectionByNameOrId('users');
    const field = users.schema.getFieldById('users_role');
    if (field) {
      field.required = true;
      dao.saveCollection(users);
    }
  },
);
