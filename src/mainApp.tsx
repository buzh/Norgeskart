import { KvibProvider, Toaster } from '@kvib/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'material-symbols/rounded.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AtomWrapper } from './AtomWrapper.tsx';
import { CookieConsentDialog } from './CookieConsentDialog.tsx';
import './index.css';
import { fetchLidarProjects } from './map/layers/config/backgroundLayers/lidarProjects.ts';
import { projInit } from './map/projections/proj/projInit.ts';
import { PostHogWrapper } from './PosthogWrapper.tsx';
projInit();

// DEBUG: eyeball the parsed lidar project list. Remove once the source
// picker consumes this data directly.
fetchLidarProjects()
  .then((projects) => {
    console.log(`[lidarProjects] ${projects.length} projects`, projects);
    (window as unknown as { __lidarProjects?: unknown }).__lidarProjects =
      projects;
  })
  .catch((err) => console.warn('[lidarProjects] failed', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AtomWrapper>
        <QueryClientProvider client={new QueryClient()}>
          <KvibProvider>
            <PostHogWrapper>
              <App />
              <Toaster />
              <CookieConsentDialog />
            </PostHogWrapper>
          </KvibProvider>
        </QueryClientProvider>
      </AtomWrapper>
    </BrowserRouter>
  </StrictMode>,
);
