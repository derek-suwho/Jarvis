import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { App } from './App';
import './styles.css';

// Desktop macOS draws its own title bar row; CSS reserves room for the traffic lights.
if (window.jarvis?.platform === 'darwin') document.documentElement.classList.add('mac-titlebar');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
