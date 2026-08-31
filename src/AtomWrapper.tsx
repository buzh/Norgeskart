import { useHydrateAtoms } from 'jotai/utils';
import 'material-symbols/rounded.css';
import { ReactNode } from 'react';
import './index.css';
import { activeThemeLayersAtom } from './map/layers/atoms.ts';
import { ThemeLayerName } from './map/layers/themeWMS.ts';
import { getListUrlParameter } from './shared/utils/urlUtils.ts';

// backgroundLayerAtom is intentionally not hydrated here — its own
// default init function already validates the URL param against a
// whitelist (see getDefaultBackgroundLayer in
// map/layers/config/backgroundLayers/atoms.ts). Hydrating a second time
// here would bypass that whitelist and could leave the atom on a value
// (e.g. `lidarProject` with no active project) that the effect can't
// render, causing a blank map on cold load.
export const AtomWrapper = ({ children }: { children: ReactNode }) => {
  const initialThemeLayersList = getListUrlParameter('themeLayers') || [];
  const initialThemeLayers = new Set(
    initialThemeLayersList as ThemeLayerName[],
  );

  useHydrateAtoms([[activeThemeLayersAtom, initialThemeLayers]]);
  return children;
};
