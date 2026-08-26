import { KvibProvider, Toaster } from '@kvib/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'material-symbols/rounded.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AtomWrapper } from './AtomWrapper.tsx';
import './index.css';
import { projInit } from './map/projections/proj/projInit.ts';
projInit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AtomWrapper>
        <QueryClientProvider client={new QueryClient()}>
          <KvibProvider>
            <App />
            <Toaster />
          </KvibProvider>
        </QueryClientProvider>
      </AtomWrapper>
    </BrowserRouter>
  </StrictMode>,
);
