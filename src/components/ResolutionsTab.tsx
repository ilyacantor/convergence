import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Check,
  X,
  Pause,
} from 'lucide-react';

interface Decision {
  id: string;
  engagement_id: string;
  domain: string;
  acquirer_record_id: string;
  target_record_id: string | null;
  confidence: number;
  evidence: Record<string, unknown> | null;
  tier_matched: number;
  hitl_state: string;
  hitl_operator: string | null;
  hitl_timestamp: string | null;
  content_hash_acq: string;
  content_hash_tgt: string | null;
  created_at: string | null;
}

interface DomainGroup {
  domain: string;
  mappings: Decision[];
  unmatched_acq: string[];
  unmatched_tgt: string[];
}

interface ResolutionsResponse {
  engagement_id: string;
  domains: DomainGroup[];
  total_decisions: number;
}

interface SummaryResponse {
  engagement_id: string;
  per_domain: Record<string, Record<string, number>>;
  totals: Record<string, number>;
  total_decisions: number;
}

const BASE = '/api/convergence';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
    throw new Error(body.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

const STATE_COLORS: Record<string, string> = {
  auto_accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  confirmed: 'bg-green-500/20 text-green-400 border-green-500/30',
  pending_hitl: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  deferred: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  stale: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  no_match: 'bg-gray-600/20 text-gray-500 border-gray-600/30',
};

function StateBadge({ state }: { state: string }) {
  const cls = STATE_COLORS[state] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {state.replace('_', ' ')}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-cyan-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function displayName(recordId: string, evidence: Record<string, unknown> | null, side: 'acq' | 'tgt'): string {
  if (evidence) {
    const nameKey = side === 'acq' ? 'acquirer_display_name' : 'target_display_name';
    if (typeof evidence[nameKey] === 'string') return evidence[nameKey] as string;
    const normKey = side === 'acq' ? 'acquirer_normalized_name' : 'target_normalized_name';
    if (typeof evidence[normKey] === 'string') return evidence[normKey] as string;
  }
  return recordId.length > 20 ? recordId.slice(0, 16) + '\u2026' : recordId;
}

function DecisionRow({
  decision,
  selected,
  focused,
  onToggleSelect,
  onAction,
}: {
  decision: Decision;
  selected: boolean;
  focused: boolean;
  onToggleSelect: () => void;
  onAction: (state: string) => void;
}) {
  const canAct = decision.hitl_state === 'pending_hitl' || decision.hitl_state === 'stale' || decision.hitl_state === 'deferred';

  return (
    <tr
      className={`border-b border-slate-700/30 transition-colors ${
        focused ? 'bg-cyan-500/10 outline outline-1 outline-cyan-500/40' : 'hover:bg-slate-700/20'
      }`}
      data-testid={`resolution-row-${decision.id}`}
      data-decision-id={decision.id}
    >
      <td className="py-2.5 px-3">
        {canAct && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
          />
        )}
      </td>
      <td className="py-2.5 px-3 text-white text-sm">
        {displayName(decision.acquirer_record_id, decision.evidence, 'acq')}
      </td>
      <td className="py-2.5 px-3 text-white text-sm">
        {decision.target_record_id
          ? displayName(decision.target_record_id, decision.evidence, 'tgt')
          : <span className="text-gray-500 italic">no match</span>}
      </td>
      <td className="py-2.5 px-3">
        <ConfidenceBar value={decision.confidence} />
      </td>
      <td className="py-2.5 px-3 text-gray-400 text-xs text-center">T{decision.tier_matched}</td>
      <td className="py-2.5 px-3">
        <StateBadge state={decision.hitl_state} />
      </td>
      <td className="py-2.5 px-3">
        {canAct && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onAction('confirmed')}
              className="p-1 text-green-400 hover:bg-green-500/20 rounded transition-colors"
              title="Accept (a)"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAction('rejected')}
              className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
              title="Reject (r)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            {decision.hitl_state !== 'deferred' && (
              <button
                onClick={() => onAction('deferred')}
                className="p-1 text-gray-400 hover:bg-gray-500/20 rounded transition-colors"
                title="Defer (d)"
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function ResolutionsTab({ engagementId }: { engagementId: string }) {
  const [resolutions, setResolutions] = useState<ResolutionsResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const [filterState, setFilterState] = useState<string | null>(null);
  const [bulkActing, setBulkActing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filterState ? `?hitl_state=${filterState}` : '';
      const [res, sum] = await Promise.all([
        apiFetch<ResolutionsResponse>(`/engagements/${engagementId}/resolutions${qs}`),
        apiFetch<SummaryResponse>(`/engagements/${engagementId}/resolutions/summary`),
      ]);
      setResolutions(res);
      setSummary(sum);
      setError(null);
      if (res.domains.length > 0 && expandedDomains.size === 0) {
        setExpandedDomains(new Set(res.domains.map((d) => d.domain)));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [engagementId, filterState]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const allDecisions = useMemo(() => {
    if (!resolutions) return [];
    return resolutions.domains.flatMap((d) => d.mappings);
  }, [resolutions]);

  const actionableDecisions = useMemo(
    () => allDecisions.filter((d) => d.hitl_state === 'pending_hitl' || d.hitl_state === 'stale' || d.hitl_state === 'deferred'),
    [allDecisions],
  );

  const handleAction = async (decisionId: string, newState: string) => {
    try {
      await apiFetch(`/engagements/${engagementId}/resolutions/${decisionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ hitl_state: newState, operator: 'convergence-ui' }),
      });
      await fetchData();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(decisionId);
        return next;
      });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleBulkAction = async (newState: string) => {
    if (selectedIds.size === 0) return;
    setBulkActing(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        apiFetch(`/engagements/${engagementId}/resolutions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ hitl_state: newState, operator: 'convergence-ui' }),
        }),
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkActing(false);
    }
  };

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllActionable = () => {
    setSelectedIds(new Set(actionableDecisions.map((d) => d.id)));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement?.tagName !== 'BODY') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusIndex((prev) => Math.min(prev + 1, allDecisions.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'a': {
          e.preventDefault();
          const focused = allDecisions[focusIndex];
          if (focused && (focused.hitl_state === 'pending_hitl' || focused.hitl_state === 'stale' || focused.hitl_state === 'deferred')) {
            handleAction(focused.id, 'confirmed');
          }
          break;
        }
        case 'r': {
          e.preventDefault();
          const focused = allDecisions[focusIndex];
          if (focused && (focused.hitl_state === 'pending_hitl' || focused.hitl_state === 'stale' || focused.hitl_state === 'deferred')) {
            handleAction(focused.id, 'rejected');
          }
          break;
        }
        case 'd': {
          e.preventDefault();
          const focused = allDecisions[focusIndex];
          if (focused && (focused.hitl_state === 'pending_hitl' || focused.hitl_state === 'stale')) {
            handleAction(focused.id, 'deferred');
          }
          break;
        }
        case ' ':
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < allDecisions.length) {
            toggleSelect(allDecisions[focusIndex].id);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [allDecisions, focusIndex]);

  if (loading && !resolutions) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totals = summary?.totals || {};

  return (
    <div ref={containerRef} className="space-y-4" tabIndex={-1}>
      {/* Summary bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {[
            { key: 'auto_accepted', icon: CheckCircle, color: 'text-green-400' },
            { key: 'confirmed', icon: CheckCircle, color: 'text-green-400' },
            { key: 'pending_hitl', icon: Clock, color: 'text-amber-400' },
            { key: 'rejected', icon: XCircle, color: 'text-red-400' },
            { key: 'deferred', icon: Clock, color: 'text-gray-400' },
          ].map(({ key, icon: Icon, color }) => {
            const count = totals[key] || 0;
            if (count === 0 && key !== 'pending_hitl') return null;
            return (
              <button
                key={key}
                onClick={() => setFilterState(filterState === key ? null : key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                  filterState === key
                    ? 'bg-cyan-600/30 border border-cyan-500/30'
                    : 'hover:bg-slate-700'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-gray-300">{count}</span>
                <span className="text-gray-500">{key.replace('_', ' ')}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-1.5 mr-2">
              <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
              <button
                onClick={() => handleBulkAction('confirmed')}
                disabled={bulkActing}
                className="px-2 py-1 text-xs bg-green-600/20 text-green-400 border border-green-500/30 rounded hover:bg-green-600/30 disabled:opacity-50 transition-colors"
              >
                Accept all
              </button>
              <button
                onClick={() => handleBulkAction('rejected')}
                disabled={bulkActing}
                className="px-2 py-1 text-xs bg-red-600/20 text-red-400 border border-red-500/30 rounded hover:bg-red-600/30 disabled:opacity-50 transition-colors"
              >
                Reject all
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>
          )}
          {actionableDecisions.length > 0 && selectedIds.size === 0 && (
            <button
              onClick={selectAllActionable}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Select all pending
            </button>
          )}
          <button
            onClick={fetchData}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Keyboard hint */}
      <div className="text-xs text-gray-600 flex items-center gap-3">
        <span><kbd className="px-1 py-0.5 bg-slate-700 rounded text-gray-400">j</kbd>/<kbd className="px-1 py-0.5 bg-slate-700 rounded text-gray-400">k</kbd> navigate</span>
        <span><kbd className="px-1 py-0.5 bg-slate-700 rounded text-gray-400">a</kbd> accept</span>
        <span><kbd className="px-1 py-0.5 bg-slate-700 rounded text-gray-400">r</kbd> reject</span>
        <span><kbd className="px-1 py-0.5 bg-slate-700 rounded text-gray-400">d</kbd> defer</span>
        <span><kbd className="px-1 py-0.5 bg-slate-700 rounded text-gray-400">space</kbd> select</span>
      </div>

      {/* Domain groups */}
      {resolutions?.domains.length === 0 && (
        <div className="text-center py-8 text-gray-500">No resolver decisions found.</div>
      )}

      {resolutions?.domains.map((group) => {
        const expanded = expandedDomains.has(group.domain);
        const domainSummary = summary?.per_domain[group.domain] || {};
        const pending = domainSummary['pending_hitl'] || 0;

        return (
          <div
            key={group.domain}
            className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden"
          >
            {/* Domain header */}
            <button
              onClick={() => toggleDomain(group.domain)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/20 transition-colors"
              data-testid={`domain-header-${group.domain}`}
            >
              <div className="flex items-center gap-2">
                {expanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
                <span className="text-white font-medium capitalize">{group.domain}</span>
                <span className="text-xs text-gray-500">
                  {group.mappings.length} mapping{group.mappings.length !== 1 ? 's' : ''}
                </span>
                {pending > 0 && (
                  <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                    {pending} pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {Object.entries(domainSummary).map(([state, count]) => (
                  <span key={state}>{count} {state.replace('_', ' ')}</span>
                ))}
              </div>
            </button>

            {/* Mappings table */}
            {expanded && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase tracking-wider border-t border-b border-slate-700/50">
                      <th className="py-2 px-3 w-8"></th>
                      <th className="text-left py-2 px-3">Acquirer Record</th>
                      <th className="text-left py-2 px-3">Target Record</th>
                      <th className="text-left py-2 px-3">Confidence</th>
                      <th className="text-center py-2 px-3">Tier</th>
                      <th className="text-left py-2 px-3">State</th>
                      <th className="py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.mappings.map((decision) => {
                      const globalIdx = allDecisions.indexOf(decision);
                      return (
                        <DecisionRow
                          key={decision.id}
                          decision={decision}
                          selected={selectedIds.has(decision.id)}
                          focused={globalIdx === focusIndex}
                          onToggleSelect={() => toggleSelect(decision.id)}
                          onAction={(state) => handleAction(decision.id, state)}
                        />
                      );
                    })}
                  </tbody>
                </table>

                {/* Unmatched records */}
                {(group.unmatched_acq.length > 0 || group.unmatched_tgt.length > 0) && (
                  <div className="px-4 py-3 border-t border-slate-700/30 text-xs text-gray-500">
                    {group.unmatched_acq.length > 0 && (
                      <div>Unmatched acquirer: {group.unmatched_acq.length} record{group.unmatched_acq.length !== 1 ? 's' : ''}</div>
                    )}
                    {group.unmatched_tgt.length > 0 && (
                      <div>Unmatched target: {group.unmatched_tgt.length} record{group.unmatched_tgt.length !== 1 ? 's' : ''}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
