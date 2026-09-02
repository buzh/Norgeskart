import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Polygon } from 'ol/geom';
import Draw, { createBox } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import { transformExtent } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style } from 'ol/style';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createLocality, LocalityBbox } from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { activeLocalityAtom, creatingLocalityAtom } from './atoms';
import { upsertLocalityOnLayer } from './localityLayer';

// "Ny lokalitet": while creatingLocalityAtom is set, one box drag on the
// map creates the record and opens its workspace. Escape cancels.
// Same freehand-box interaction as the LiDAR extract selection, so the
// gesture is consistent everywhere an area is marked.

const DRAFT_LAYER_ID = 'localityDraftLayer';

const draftStyle = new Style({
  stroke: new Stroke({ color: '#FF6A00', width: 2, lineDash: [6, 4] }),
  fill: new Fill({ color: 'rgba(255, 106, 0, 0.08)' }),
});

export const useLocalityCreate = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const [creating, setCreating] = useAtom(creatingLocalityAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);

  useEffect(() => {
    if (!creating) return;
    if (!user) {
      setCreating(false);
      return;
    }

    const source = new VectorSource({ wrapX: false });
    const layer = new VectorLayer({
      source,
      zIndex: 7,
      style: draftStyle,
      properties: { id: DRAFT_LAYER_ID },
    });
    map.addLayer(layer);

    const draw = new Draw({
      source,
      type: 'Circle',
      geometryFunction: createBox(),
      freehand: true,
      style: draftStyle,
    });

    draw.on('drawend', (event) => {
      const geom = event.feature.getGeometry();
      if (!(geom instanceof Polygon)) return;
      const mapProjection = map.getView().getProjection().getCode();
      const bbox = transformExtent(
        geom.getExtent(),
        mapProjection,
        'EPSG:4326',
      ) as LocalityBbox;

      createLocality(
        {
          name: t('localities.defaultName'),
          visibility: 'private',
          bbox,
        },
        user.id,
      )
        .then((rec) => {
          upsertLocalityOnLayer(rec);
          setActiveLocality(rec);
        })
        .catch((e) => {
          console.warn('[useLocalityCreate] create failed', e);
          // Surface it — a silent failure here looks like "the button
          // does nothing" (classic cause: pocketbase not restarted after
          // a migration change, so the collection doesn't exist).
          window.alert(t('localities.createFailed'));
        })
        .finally(() => {
          setCreating(false);
        });
    });

    map.addInteraction(draw);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCreating(false);
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      map.removeInteraction(draw);
      map.removeLayer(layer);
    };
  }, [creating, map, user, setCreating, setActiveLocality, t]);
};
