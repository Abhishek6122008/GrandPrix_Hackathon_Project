import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import SetupPage from './pages/SetupPage.jsx';
import LivePage from './pages/LivePage.jsx';
import SummaryPage from './pages/SummaryPage.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Crowd Flow Optimiser</h1>
        <nav>
          <NavLink to="/setup">Setup</NavLink>
          <NavLink to="/live">Live</NavLink>
          <NavLink to="/summary">Summary</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/live/:simulationId" element={<LivePage />} />
          <Route path="/summary" element={<SummaryPage />} />
          <Route path="/summary/:simulationId" element={<SummaryPage />} />
          <Route path="*" element={<p>Nothing here.</p>} />
        </Routes>
      </main>
    </div>
  );
}
