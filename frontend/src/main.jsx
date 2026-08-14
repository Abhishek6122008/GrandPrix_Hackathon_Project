import React from 'react';
import { createRoot } from 'react-dom/client';
import CrowdFlowApp from './CrowdFlowApp.jsx';
import './styles/index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CrowdFlowApp />
  </React.StrictMode>,
);
