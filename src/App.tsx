import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { MergePanel } from './components/MergePanel';

const ReportPortal = React.lazy(() =>
  import('./components/report-portal/ReportPortal').then(m => ({ default: m.ReportPortal }))
);
const EngagementMonitor = React.lazy(() => import('./components/EngagementMonitor'));
const Upload = React.lazy(() => import('./components/Upload'));

function NavBar() {
  const location = useLocation();
  const isMerge = location.pathname === '/' || location.pathname.startsWith('/merge');
  const isReports = location.pathname.startsWith('/reports');
  const isEngagements = location.pathname.startsWith('/engagements');
  const isUpload = location.pathname.startsWith('/upload');
  return (
    <div className="shrink-0 border-b border-border bg-card/50">
      <div className="flex items-center h-12 px-4 gap-6">
        <span className="font-semibold text-primary">AOS Convergence</span>
        <nav className="flex gap-4 text-sm">
          <Link
            to="/"
            className={`hover:text-primary transition-colors ${isMerge ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            Merge
          </Link>
          <Link
            to="/engagements"
            className={`hover:text-primary transition-colors ${isEngagements ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            Engagements
          </Link>
          <Link
            to="/reports"
            className={`hover:text-primary transition-colors ${isReports ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            Reports
          </Link>
          <Link
            to="/upload"
            className={`hover:text-primary transition-colors ${isUpload ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            Upload
          </Link>
        </nav>
      </div>
    </div>
  );
}

// ── Parent-frame bridge ────────────────────────────────────────────────
// Listens for postMessage commands from the AOS Platform demo shell.
// Supported actions:
//   { action: 'reportNavigate', entity: 'combined'|'meridian'|'cascadia', tab: 'pl'|... }
//
// On reportNavigate we must (a) route to /reports so the ReportPortal lazy
// component mounts, and (b) dispatch the 'aos-report-navigate' CustomEvent
// that ReportPortal's own handler already listens for (lines ~2270-2287).
//
// Must live INSIDE <BrowserRouter> because useNavigate() requires router
// context. No silent fallback — unknown actions log a warning and stop.
function IframeMessageBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || !data.action) return;

      console.log('[Convergence] postMessage received:', data);

      switch (data.action) {
        case 'reportNavigate': {
          const dispatchDetail = () => {
            window.dispatchEvent(
              new CustomEvent('aos-report-navigate', {
                detail: { entity: data.entity, tab: data.tab },
              }),
            );
          };
          if (!location.pathname.startsWith('/reports')) {
            navigate('/reports');
            // ReportPortal is React.lazy — give it a tick to mount before
            // firing the CustomEvent its useEffect handler listens for.
            setTimeout(dispatchDetail, 150);
          } else {
            dispatchDetail();
          }
          break;
        }
        default:
          console.warn(`[Convergence] Unknown postMessage action: ${data.action}`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [navigate, location.pathname]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <IframeMessageBridge />
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">
        <NavBar />
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route
              path="/engagements"
              element={
                <React.Suspense
                  fallback={
                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '40px', textAlign: 'center' }}>
                      Loading Engagements...
                    </div>
                  }
                >
                  <EngagementMonitor />
                </React.Suspense>
              }
            />
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
            <Route
              path="/upload"
              element={
                <React.Suspense
                  fallback={
                    <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: '12px', padding: '40px', textAlign: 'center' }}>
                      Loading Upload...
                    </div>
                  }
                >
                  <Upload />
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
