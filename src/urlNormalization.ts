import { transitionHashToQuery } from './shared/utils/urlUtils.ts';

// Runs before React mounts (see main.tsx). Only surviving job is
// migrating pre-existing hash-fragment URLs (`#lat=…&lon=…`) to the
// query string. Legacy numeric layer-id handling (`?layers=1001,…`) is
// gone with the self-host strip — those ids named the old Norgeskart
// backgrounds/themes we no longer carry.
export const processUrlParameters = () => {
  transitionHashToQuery();
};
