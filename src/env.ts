type layerProviderParameters = {
  kartverketCache: {
    baseUrl: string;
  };
  geoNorgeWMS: {
    baseUrl: string;
  };
};

type EnvName = 'local' | 'dev' | 'test' | 'prod';
type Env = {
  apiUrl: string;
  geoNorgeApiBaseUrl: string;
  // Same-origin path proxied by Caddy → pocketbase container. Overridable
  // for local `vite dev` where the SPA runs on :5173 and PB on :8090.
  pocketbaseUrl: string;
  layerProviderParameters: layerProviderParameters;
  envName: EnvName;
};

const LOCAL_ENV: Env = {
  apiUrl: 'https://testapi.norgeskart.no',
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',
  pocketbaseUrl: '/pb',
  layerProviderParameters: {
    kartverketCache: {
      baseUrl: 'https://cache.kartverket.no',
    },
    geoNorgeWMS: {
      baseUrl: '/wms/geonorge/wms',
    },
  },
  envName: 'local',
};

const DEV_ENV: Env = {
  apiUrl: 'https://testapi.norgeskart.no',
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',
  pocketbaseUrl: '/pb',
  layerProviderParameters: {
    kartverketCache: {
      baseUrl: 'https://cache.kartverket.no',
    },
    geoNorgeWMS: {
      baseUrl: '/wms/geonorge/wms',
    },
  },
  envName: 'dev',
};

const PROD_ENV: Env = {
  apiUrl: 'https://api.norgeskart.no',
  geoNorgeApiBaseUrl: 'https://ws.geonorge.no',
  pocketbaseUrl: '/pb',
  layerProviderParameters: {
    kartverketCache: {
      baseUrl: 'https://cache.kartverket.no',
    },
    geoNorgeWMS: {
      baseUrl: '/wms/geonorge/wms',
    },
  },
  envName: 'prod',
};

const getEnvName = (): EnvName => {
  return getEnv().envName;
};

declare global {
  interface Window {
    __NK_CONFIG__?: Partial<Env> & {
      layerProviderParameters?: Partial<layerProviderParameters>;
    };
  }
}

const getEnvByHostname = (): Env => {
  const domain = document.location.hostname;
  const previewRegex =
    /norgeskart-preview-.+\.atkv3-dev\.kartverket(?:-intern)?\.cloud/m;
  if (domain == 'localhost') {
    return LOCAL_ENV;
  }
  if (
    domain == 'norgeskart.atgcp1-dev.kartverket-intern.cloud' ||
    domain == 'norgeskart5.atkv3-dev.kartverket-intern.cloud'
  ) {
    return DEV_ENV;
  }
  if (previewRegex.test(domain)) {
    return DEV_ENV;
  }
  if (
    domain == 'test.norgeskart.no' ||
    domain == 'norgeskart.no' ||
    domain == 'www.norgeskart.no'
  ) {
    return PROD_ENV;
  }
  console.error(`Unknown domain: ${domain}`);
  return DEV_ENV;
};

const getEnv = (): Env => {
  const base = getEnvByHostname();
  const override = typeof window !== 'undefined' ? window.__NK_CONFIG__ : undefined;
  if (!override) return base;
  return {
    ...base,
    ...override,
    layerProviderParameters: {
      ...base.layerProviderParameters,
      ...(override.layerProviderParameters ?? {}),
    },
  };
};

export { getEnv, getEnvName };
