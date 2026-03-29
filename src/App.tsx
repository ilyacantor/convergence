import { MergePanel } from './components/MergePanel';

function App() {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">
      <div className="shrink-0 border-b border-border bg-card/50">
        <div className="flex items-center h-12 px-4 gap-4">
          <span className="font-semibold text-primary">AOS Convergence</span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <MergePanel />
      </div>
    </div>
  );
}

export default App;
