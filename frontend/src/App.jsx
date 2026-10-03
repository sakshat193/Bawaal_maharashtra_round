import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ConcertApp from './pages/concert/ConcertApp.jsx';
import FairDrop from './pages/FairDrop.jsx';
import Verify from './pages/Verify.jsx';
import JudgeDashboard from './pages/JudgeDashboard.jsx';
import FanResults from './pages/FanResults.jsx';

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <Routes>
      <Route path="/" element={<ConcertApp />} />
      <Route path="/drop" element={<FairDrop />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/judges" element={<JudgeDashboard />} />
      <Route path="/results" element={<FanResults />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
