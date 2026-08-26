import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Debug } from './debug/Debug.tsx';
import { HelpPage } from './help/HelpPage.tsx';
import './i18n';
import { Layout } from './Layout.tsx';
import { useMapSettings } from './map/mapHooks.ts';
import { MapLegendDrawer } from './map/menu/drawers/MapLegendDrawer.tsx';
import { MessageBox } from './messages/MessageBox.tsx';

export const App = () => {
  const { setMapFullScreen } = useMapSettings();

  const fullscreenClickHandler = (event: KeyboardEvent) => {
    if (event.key === 'F11') {
      event.preventDefault();
      setMapFullScreen(true);
      event.stopPropagation();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', fullscreenClickHandler);
    return () => {
      document.removeEventListener('keydown', fullscreenClickHandler);
    };
  });

  return (
    <>
      <MessageBox />
      <MapLegendDrawer />
      <Debug />
      <Routes>
        <Route path="/" element={<Layout />} />
        <Route path="/hjelp" element={<HelpPage />} />
      </Routes>
    </>
  );
};

export default App;
