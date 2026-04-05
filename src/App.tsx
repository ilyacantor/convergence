import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { MergePanel } from './components/MergePanel';

const ReportPortal = React.lazy(() =>
  import('./components/report-portal/ReportPortal').then(m => ({ default: m.ReportPortal }))
);

function NavBar() {
  const location = useLocation();
  const isReports = location.pathname.startsWith('/reports');
  return (
    <div className="shrink-0 border-b border-border bg-card/50">
      <div className="flex items-center h-12 px-4 gap-6">
        <span className="font-semibold text-primary">AOS Convergence</span>
        <nav className="flex gap-4 text-sm">
          <Link
            to="/"
            className={`hover:text-primary transition-colors ${!isReports ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            Merge
          </Link>
          <Link
            to="/reports"
            className={`hover:text-primary transition-colors ${isReports ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            Reports
          </Link>
        </nav>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">
        <NavBar />
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route
              path="/reports"
              element={
                <React.Suspense
                  fallback={
                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '40px', textAlign: 'center' }}>
                      Loading Reports...
                    </div>
                  }
                >
                  <ReportPortal onClose={() => { /* no-op when standalone */ }} />
                </React.Suspense>
              }
            />
            <Route path="/*" element={<MergePanel />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
