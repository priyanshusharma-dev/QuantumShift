import { lazy, Suspense, Component } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading, Button } from './components/ui';
import { useApp } from './context/AppContext';

const Landing = lazy(() => import('./pages/Landing'));
const Workspace = lazy(() => import('./pages/Workspace'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Discovery = lazy(() => import('./pages/Discovery'));
const AstScanner = lazy(() => import('./pages/AstScanner'));
const Cbom = lazy(() => import('./pages/Cbom'));
const Risk = lazy(() => import('./pages/Risk'));
const Planner = lazy(() => import('./pages/Planner'));
const CodeMode = lazy(() => import('./pages/CodeMode'));
const Agents = lazy(() => import('./pages/Agents'));
const Testing = lazy(() => import('./pages/Testing'));
const PullRequests = lazy(() => import('./pages/PullRequests'));
const Audit = lazy(() => import('./pages/Audit'));
const Architecture = lazy(() => import('./pages/Architecture'));
const WorkflowPage = lazy(() => import('./pages/Workflow'));
const Feasibility = lazy(() => import('./pages/Feasibility'));
const Impact = lazy(() => import('./pages/Impact'));
const Settings = lazy(() => import('./pages/Settings'));
const Demo = lazy(() => import('./pages/Demo'));
const RepositoryDetail = lazy(() => import('./pages/RepositoryDetail'));
const NotFound = lazy(() => import('./pages/NotFound'));

class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="glass mx-auto mt-10 max-w-lg rounded-2xl p-6 text-center">
          <div className="text-lg font-semibold">Something went wrong on this page</div>
          <p className="mt-2 text-sm text-slate-400">{this.state.error.message}</p>
          <Button className="mt-4" onClick={() => { this.setState({ error: null }); window.location.reload(); }}>Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { user, authError } = useApp();
  if (authError) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="glass max-w-md rounded-2xl p-6 text-center">
          <div className="text-lg font-semibold text-white">Backend unavailable</div>
          <p className="mt-2 text-sm text-slate-400">{authError}</p>
          <p className="mt-2 text-xs text-slate-500">Start the API with <code className="code-font text-sky-300">npm run dev</code> from the project root.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!user) return <Loading label="Signing in with demo SSO…" className="min-h-full" />;
  return (
    <Routes>
      <Route element={<Layout />}>
        {[
          ['/', Landing], ['/workspace', Workspace], ['/dashboard', Dashboard], ['/discovery', Discovery], ['/ast-scanner', AstScanner],
          ['/cbom', Cbom], ['/risk', Risk], ['/planner', Planner], ['/code-mode', CodeMode], ['/agents', Agents], ['/testing', Testing],
          ['/pull-requests', PullRequests], ['/audit', Audit], ['/architecture', Architecture], ['/workflow', WorkflowPage], ['/feasibility', Feasibility],
          ['/impact', Impact], ['/settings', Settings], ['/demo', Demo], ['/repositories/:id', RepositoryDetail], ['*', NotFound],
        ].map(([path, C]) => (
          <Route key={path} path={path} element={<ErrorBoundary key={path}><Suspense fallback={<Loading />}><C /></Suspense></ErrorBoundary>} />
        ))}
      </Route>
    </Routes>
  );
}
