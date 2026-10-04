import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ConcertApp from './pages/concert/ConcertApp.jsx';
import Verify from './pages/Verify.jsx';
import JudgeDashboard from './pages/JudgeDashboard.jsx';
import DemoPanel from './pages/DemoPanel.jsx';
import DropPage from './drop/DropPage.jsx';

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <Routes>
      <Route path="/" element={<ConcertApp />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/verify/:dropId" element={<Verify />} />
      <Route path="/drops/:dropId" element={<DropPage />} />
      <Route path="/judges" element={<JudgeDashboard />} />
      <Route path="/demo" element={<DemoPanel />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
