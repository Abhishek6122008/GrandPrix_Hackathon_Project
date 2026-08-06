import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import SummaryReport from '../components/Summary/SummaryReport.jsx';
import { useSimulationApi } from '../hooks/useSimulationApi.js';
import { mockAdvisories, mockSummary } from '../mockData.js';

export default function SummaryPage() {
  const { simulationId } = useParams();
  const api = useSimulationApi();
  const [summary, setSummary] = useState(mockSummary);
  const [advisories, setAdvisories] = useState(mockAdvisories);

  useEffect(() => {
    if (!simulationId) return;
    api.getSummary(simulationId).then(setSummary).catch(() => {});
    api.getAdvisories(simulationId).then(setAdvisories).catch(() => {});
  }, [api, simulationId]);

  return (
    <div>
      <SummaryReport summary={summary} />
      <div style={{ height: 16 }} />
      <div className="panel">
        <h3 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Advisories issued</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {advisories.map((a, i) => (
            <li key={i}>
              t{a.tick} · {a.nodeId} — {a.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
