import { WMSBackgroundLayer } from './types';

// The reference half of hybrid mode: roads, railways and place names
// drawn on transparency over the LiDAR relief. Kartverket's topo WMS
// renders any subset of its group layers, so asking for only the
// reference features gives a genuine overlay — no terrain, no landcover,
// no background fill — which beats the alternative of fading the LiDAR
// down until the topo map shows through it.
//
// Two families of groups because neither covers the whole zoom range:
// the kd_* groups are the generalized (N50-ish) cartography and stop
// rendering somewhere around 1:25 000, where the fkb_* groups take over
// with the large-scale detail. Asking for all five lets the server
// decide which apply at the current scale.
const OVERLAY_LAYERS = [
  'kd_veger',
  'kd_jernbane',
  'kd_stedsnavn',
  'fkb_samferdsel',
  'fkb_presentasjonsdata',
].join(',');

export const TOPO_OVERLAY_CONFIG: WMSBackgroundLayer = {
  type: 'WMS',
  layerName: 'topoOverlay',
  // Same /wms/geonorge/* Caddy handler as the LiDAR layers, different
  // service — the handler passes the whole path through, so no proxy
  // config change was needed to add this one.
  url: '/wms/geonorge/wms.topo',
  props: {
    LAYERS: OVERLAY_LAYERS,
    TRANSPARENT: true,
    VERSION: '1.3.0',
  },
  // Deliberately no retryBlankTileLoadFunction. That loader exists
  // because the DTM renderer sometimes returns a blank tile where there
  // is data; here a blank tile is the normal case (no road, no name out
  // in the woods) and every one of them would burn the full retry
  // budget before being accepted anyway.
};
