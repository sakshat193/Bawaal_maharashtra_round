import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/global.css';
import './styles/concert.css';

if (import.meta.env.VITE_MSW === '1') {
  await (await import('./api/mocks.js')).start();
}

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
);
