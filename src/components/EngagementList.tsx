import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Plus,
  ChevronRight,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';

interface Engagement {
  engagement_id: string;
  acquirer_entity_id: string;
  target_entity_id: string;
  engagement_short_name: string | null;
  tenant_id: string;
  engagement_type: string;
  lifecycle_stage: string;
  created_at: string;
  updated_at: string;
}

const BASE = '/api/convergence';
const TENANT_ID = (import.meta.env.VITE_AOS_TENANT_ID as string) || '';

async function apiFetch<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
    throw new Error(body.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

const STAGE_COLORS: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  archived: 'bg-gray-600/20 text-gray-500 border-gray-600/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

function StageBadge({ stage }: { stage: string }) {
  const cls = STAGE_COLORS[stage] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {stage === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {stage}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type FilterStage = 'all' | 'active' | 'draft' | 'paused' | 'archived';

export default function EngagementList() {
  const navigate = useNavigate();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState<FilterStage>('all');

  const fetchEngagements = useCallback(async () => {
    try {
      const data = await apiFetch<Engagement[]>(
        `/engagements?tenant_id=${encodeURIComponent(TENANT_ID)}`,
      );
      setEngagements(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEngagements();
  }, [fetchEngagements]);

  const filtered = useMemo(() => {
    let list = [...engagements].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    if (filterStage !== 'all') {
      list = list.filter((e) => e.lifecycle_stage === filterStage);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          (e.engagement_short_name || '').toLowerCase().includes(q) ||
          e.acquirer_entity_id.toLowerCase().includes(q) ||
          e.target_entity_id.toLowerCase().includes(q),
      );
    }
    return list;
  }, [engagements, filterStage, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading engagements...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyan-400" />
          Engagements
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchEngagements}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/engagements/new')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Engagement
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search engagements..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-gray-500" />
          {(['all', 'active', 'draft', 'paused', 'archived'] as FilterStage[]).map((stage) => (
            <button
              key={stage}
              onClick={() => setFilterStage(stage)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                filterStage === stage
                  ? 'bg-cyan-600/30 text-cyan-400 border border-cyan-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {stage}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {engagements.length === 0
            ? 'No engagements yet. Create one to get started.'
            : 'No engagements match your filters.'}
        </div>
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-slate-700/50">
                <th className="text-left py-3 px-4">Engagement</th>
                <th className="text-left py-3 px-4">Entities</th>
                <th className="text-left py-3 px-4">Stage</th>
                <th className="text-left py-3 px-4">Type</th>
                <th className="text-left py-3 px-4">Created</th>
                <th className="text-left py-3 px-4">Updated</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((eng) => (
                <tr
                  key={eng.engagement_id}
                  onClick={() => navigate(`/engagements/${eng.engagement_id}`)}
                  className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors cursor-pointer group"
                  data-testid={`engagement-row-${eng.engagement_id}`}
                >
                  <td className="py-3 px-4">
                    <span className="text-white font-medium">
                      {eng.engagement_short_name || eng.engagement_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-gray-300">{eng.acquirer_entity_id}</span>
                    <span className="text-gray-500 mx-1.5">&harr;</span>
                    <span className="text-gray-300">{eng.target_entity_id}</span>
                  </td>
                  <td className="py-3 px-4">
                    <StageBadge stage={eng.lifecycle_stage} />
                  </td>
                  <td className="py-3 px-4 text-gray-400">{eng.engagement_type}</td>
                  <td className="py-3 px-4 text-gray-400 text-xs">{relativeTime(eng.created_at)}</td>
                  <td className="py-3 px-4 text-gray-400 text-xs">{relativeTime(eng.updated_at)}</td>
                  <td className="py-3 px-4 text-right">
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      <div className="text-xs text-gray-500 text-center">
        {filtered.length} of {engagements.length} engagement{engagements.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
