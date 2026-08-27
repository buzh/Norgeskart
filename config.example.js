// Runtime configuration for a self-hosted deployment.
// Copy this file to /config.js at the site root (docker-compose mounts
// ./config.js from the repo root into /var/www/config.js).
//
// Anything you set here overrides the compiled-in defaults from src/env.ts.
// Omit a field to keep the default.
window.__NK_CONFIG__ = {
  envName: 'selfhost',

  // Drawing save/load and cadastral property lookup. These endpoints are
  // Kartverket-hosted and CORS-locked to their own domains — expect them
  // to fail from a private server until you stand up your own backend or
  // a permitted proxy.
  apiUrl: 'https://api.norgeskart.no',

  // Public service that works directly from the browser.
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',

  layerProviderParameters: {
    kartverketCache: { baseUrl: 'https://cache.kartverket.no' },
    // Fronted by the wmscache sidecar via Caddy. Change only if you want to
    // bypass the cache and go straight to origin.
    geoNorgeWMS: { baseUrl: '/wms/geonorge/wms' },
  },
};
