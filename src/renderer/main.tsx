/**
 * Renderer entry point. Everything else lives in app/: providers, routes and the shell.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
