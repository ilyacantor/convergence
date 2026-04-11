/**
 * Engagement Monitor
 *
 * Operator monitoring page for engagement lifecycle.
 * Three panels: Engagement Status, Run Ledger, Human Review Queue.
 */

import { useState, useEffect, useCallback, useRef, Fragment, useMemo } from 'react';
import {
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Plus,
  Eye,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface Engagement {
  engagement_id: string;
  acquirer_entity_id: string;
  target_entity_id: string;
  engagement_short_name: string | null;
  tenant_id: string;
  engagement_type: string;
  lifecycle_stage: string;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Legacy aliases from engagement_store._row_to_dict
  entity_a?: string;
  entity_b?: string;
  entity_a_id?: string;
  entity_b_id?: string;
  status?: string;
}

interface EngagementStatus {
  status: string;
  active_engagement: Engagement | null;
  pending_reviews_count: number;
}

interface LedgerStep {
  step_id: string;
  engagement_id: string;
  step_name: string;
  status: string;
  idempotency_key: string;
  inputs_hash: string;
  upstream_deps: string[] | null;
  outputs_ref: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface RunStats {
  source_run_tag: string | null;
  triple_count: number;
  domain_count: number;
  entity_count: number;
  domain_breakdown: Record<string, number>;
  conflict_count: number;
  conflicts_resolved: number;
  conflicts_pending: number;
  mapped_count: number;
  resolved_count: number;
}

interface Review {
  review_id: string;
  engagement_id: string;
  action: string;
  context: Record<string, unknown>;
  tier: number;
  status: string;
  requested_by: string;
  approved_by: string | null;
  rejected_by: string | null;
  reason: string | null;
  created_at: string;
}


// ============================================================================
// API helpers
// ============================================================================

const BASE = '/api/convergence';
const TENANT_ID = (import.meta.env.VITE_AOS_TENANT_ID as string) || '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(body.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

// ============================================================================
// Utility
// ============================================================================

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function durationBetween(start: string | null, end: string | null): string {
  if (!start) return '\u2014';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Extract a display-friendly source tag from the step's outputs_ref.
 *  Each step stores its own tag at write time — do not use a global value. */
function displaySourceTag(outputsRef: string | null): string {
  if (!outputsRef) return '\u2014';
  if (outputsRef.startsWith('triples_')) return outputsRef;
  const match = outputsRef.match(/run_id=([a-f0-9-]+)/);
  if (match) return match[1].slice(0, 8);
  return outputsRef.length > 20 ? outputsRef.slice(0, 16) + '\u2026' : outputsRef;
}

/** Format large numbers with locale separators */
function fmtNum(n: number): string {
  return n.toLocaleString();
}

// ============================================================================
// Status badge
// ============================================================================

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  complete: 'bg-green-500/20 text-green-400 border-green-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  stale: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  archived: 'bg-gray-600/20 text-gray-500 border-gray-600/30',
  approved: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  operational: 'bg-green-500/20 text-green-400 border-green-500/30',
};

function StatusBadge({ status, pulse }: { status: string; pulse?: boolean }) {
  const cls = STATUS_COLORS[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {status}
    </span>
  );
}

// Tier colors for review cards
const TIER_COLORS: Record<number, string> = {
  1: 'bg-green-500/20 text-green-400',
  2: 'bg-blue-500/20 text-blue-400',
  3: 'bg-amber-500/20 text-amber-400',
  4: 'bg-red-500/20 text-red-400',
};

// ============================================================================
// Panel 1: Engagement Status (compact inline)
// ============================================================================

function EngagementStatusPanel({
  engagements,
  engagementStatus,
  onCreateEngagement,
  onActivateEngagement,
  creating,
  selectedEngagementId,
  onSelectEngagement,
}: {
  engagements: Engagement[];
  engagementStatus: EngagementStatus | null;
  onCreateEngagement: () => void;
  onActivateEngagement: (id: string) => void;
  creating: boolean;
  selectedEngagementId: string | null;
  onSelectEngagement: (id: string) => void;
}) {
  const selectedEngagement = selectedEngagementId ? engagements.find(e => e.engagement_id === selectedEngagementId) ?? null : null;
  const activeEngagement = engagements.find(e => e.lifecycle_stage === 'active') ?? null;
  // No silent fallback: if there's no active and no explicit selection, surface the problem (A1).
  const displayEngagement = selectedEngagement || activeEngagement || null;

  if (engagements.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Activity className="w-4 h-4 text-cyan-400" />
          No active engagement
        </div>
        <button
          onClick={onCreateEngagement}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {creating ? 'Creating...' : 'Create Engagement'}
        </button>
      </div>
    );
  }

  // Fail-loud: engagements exist but none is active and nothing is selected.
  // Do not default to "first in list" or "last in list" — surface the bug.
  if (!displayEngagement) {
    return (
      <div className="bg-red-900/40 rounded-lg border border-red-700/60 px-4 py-3 flex items-center gap-2 text-red-200 text-sm">
        <Activity className="w-4 h-4 flex-shrink-0" />
        No active engagement found among {engagements.length} engagement(s). Activate one to continue.
      </div>
    );
  }

  const entityA = displayEngagement?.acquirer_entity_id || '';
  const entityB = displayEngagement?.target_entity_id || '';
  const sysStatus = engagementStatus?.status || '\u2014';

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 px-4 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Compact inline status */}
        <div className="flex items-center gap-2.5 text-sm min-w-0 flex-wrap">
          <Activity className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          {displayEngagement && (
            <>
              <span className="text-white font-mono text-xs">{displayEngagement.engagement_short_name || `${displayEngagement.acquirer_entity_id} + ${displayEngagement.target_entity_id}`}</span>
              <span className="text-gray-600">&middot;</span>
              <StatusBadge status={displayEngagement.lifecycle_stage} pulse={displayEngagement.lifecycle_stage === 'active'} />
              {displayEngagement.lifecycle_stage === 'draft' && (
                <button
                  onClick={() => onActivateEngagement(displayEngagement.engagement_id)}
                  className="px-2 py-0.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded transition-colors"
                >
                  Activate
                </button>
              )}
              <span className="text-gray-600">&middot;</span>
              <span className="text-gray-300 text-xs">{entityA}</span>
              <span className="text-gray-500 text-xs">&harr;</span>
              <span className="text-gray-300 text-xs">{entityB}</span>
              <span className="text-gray-600">&middot;</span>
              <span className="text-gray-500 text-xs">{relativeTime(displayEngagement.created_at)}</span>
              <span className="text-gray-600">&middot;</span>
              <StatusBadge status={sysStatus} />
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {engagements.length > 1 && (
            <select
              value={selectedEngagementId || displayEngagement?.engagement_id || ''}
              onChange={(e) => onSelectEngagement(e.target.value)}
              className="bg-slate-700 text-gray-300 text-xs rounded px-2 py-1 border border-slate-600"
            >
              {engagements.map((e) => {
                const isActive = e.lifecycle_stage === 'active';
                return (
                  <option key={e.engagement_id} value={e.engagement_id}>
                    {isActive ? '* ' : ''}{e.engagement_short_name || `${e.acquirer_entity_id} + ${e.target_entity_id}`}{isActive ? ' (active)' : ''}
                  </option>
                );
              })}
            </select>
          )}
          <button
            onClick={onCreateEngagement}
            disabled={creating}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 text-white text-xs font-medium rounded transition-colors"
          >
            <Plus className="w-3 h-3" />
            {creating ? '...' : 'New'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Panel 2: Run Ledger
// ============================================================================

function RunLedgerPanel({
  steps,
  loading,
  error,
  autoRefresh,
  onToggleAutoRefresh,
  onRefresh,
  engagementId,
}: {
  steps: LedgerStep[];
  loading: boolean;
  error: string | null;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  engagementId: string | null;
}) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Clock className="w-5 h-5 text-purple-400" />
          Run Ledger
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={onToggleAutoRefresh}
              className="rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500"
            />
            Auto-refresh
          </label>
          <button
            onClick={onRefresh}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {steps.length === 0 && !error ? (
        <div className="text-center py-8 text-gray-500">No steps recorded</div>
      ) : (
        <div className="overflow-auto max-h-[280px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-800 z-10">
              <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-slate-700/50">
                <th className="text-left py-2 px-3">Step Name</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Source Run Tag</th>
                <th className="text-left py-2 px-3">Started</th>
                <th className="text-left py-2 px-3">Completed</th>
                <th className="text-left py-2 px-3">Duration</th>
                <th className="text-left py-2 px-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => {
                const isExpanded = expandedSteps.has(step.step_id);

                return (
                  <Fragment key={step.step_id}>
                    <tr
                      className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors cursor-pointer"
                      onClick={() => toggleStep(step.step_id)}
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                            : <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                          }
                          <span className="text-white font-medium">{step.step_name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge status={step.status} pulse={step.status === 'running'} />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-amber-400 font-mono text-xs bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                          {displaySourceTag(step.outputs_ref)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-400 font-mono text-xs">{formatTime(step.started_at)}</td>
                      <td className="py-2.5 px-3 text-gray-400 font-mono text-xs">{formatTime(step.completed_at)}</td>
                      <td className="py-2.5 px-3 text-gray-400">{durationBetween(step.started_at, step.completed_at)}</td>
                      <td className="py-2.5 px-3">
                        {step.error ? (
                          <span className="text-red-400 text-xs truncate block max-w-[150px]" title={step.error}>
                            {step.error}
                          </span>
                        ) : (
                          <span className="text-gray-600">{'\u2014'}</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${step.step_id}-detail`} className="bg-slate-700/10">
                        <td colSpan={7} className="px-6 py-3">
                          <StepDetail step={step} engagementId={engagementId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Expanded step detail — fetches per-step stats scoped to that step's source_run_tag */
function StepDetail({ step, engagementId }: { step: LedgerStep; engagementId: string | null }) {
  const tag = displaySourceTag(step.outputs_ref);
  const duration = durationBetween(step.started_at, step.completed_at);
  const isCofa = step.step_name === 'cofa-map';
  const [stats, setStats] = useState<RunStats | null>(null);

  useEffect(() => {
    if (!engagementId) return;
    // Pass the step's source_run_tag to scope stats to this specific run
    const tagParam = step.outputs_ref?.startsWith('triples_') ? step.outputs_ref : null;
    const params = new URLSearchParams();
    if (tagParam) params.set('source_run_tag', tagParam);
    // For cofa-map steps, use DCL merge overview (COFA triples have no source_run_tag)
    if (step.step_name) params.set('step_type', step.step_name);
    const qs = params.toString() ? `?${params.toString()}` : '';
    apiFetch<RunStats>(`/run-stats/${engagementId}${qs}`)
      .then(setStats)
      .catch(() => setStats(null));
  }, [engagementId, step.outputs_ref, step.step_name]);

  // Domain breakdown — sorted by count descending
  const domainEntries = stats?.domain_breakdown
    ? Object.entries(stats.domain_breakdown).sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div className="space-y-3">
      {/* Run statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="bg-slate-700/30 rounded p-2">
          <div className="text-gray-500 mb-0.5">Source</div>
          <div className="text-amber-400 font-mono">{tag}</div>
        </div>
        <div className="bg-slate-700/30 rounded p-2">
          <div className="text-gray-500 mb-0.5">Triples</div>
          <div className="text-white">
            {stats ? (
              <>
                {fmtNum(stats.triple_count)}
                {stats.domain_count > 0 && (
                  <span className="text-gray-500 ml-1">
                    ({stats.domain_count} domains, {stats.entity_count} entities)
                  </span>
                )}
              </>
            ) : (
              <span className="text-gray-500">{'\u2014'}</span>
            )}
          </div>
        </div>
        <div className="bg-slate-700/30 rounded p-2">
          <div className="text-gray-500 mb-0.5">Duration</div>
          <div className="text-white">{duration}</div>
        </div>
        <div className="bg-slate-700/30 rounded p-2">
          <div className="text-gray-500 mb-0.5">Conflicts</div>
          <div className="text-white">
            {stats ? (
              <>
                {stats.conflict_count} found
                <span className="text-gray-500 ml-1">
                  ({stats.conflicts_resolved} resolved, {stats.conflicts_pending} pending)
                </span>
              </>
            ) : (
              <span className="text-gray-500">{'\u2014'}</span>
            )}
          </div>
        </div>
      </div>

      {/* COFA-specific stats (cofa-map steps only) */}
      {isCofa && stats && (stats.mapped_count > 0 || stats.resolved_count > 0) && (
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-700/30 rounded p-2">
            <div className="text-gray-500 mb-0.5">Accounts Mapped</div>
            <div className="text-white">{fmtNum(stats.mapped_count)}</div>
          </div>
          <div className="bg-slate-700/30 rounded p-2">
            <div className="text-gray-500 mb-0.5">Conflicts Resolved</div>
            <div className="text-white">{fmtNum(stats.resolved_count)}</div>
          </div>
          <div className="bg-slate-700/30 rounded p-2">
            <div className="text-gray-500 mb-0.5">Conflicts Detected</div>
            <div className="text-white">{fmtNum(stats.conflict_count)}</div>
          </div>
        </div>
      )}

      {/* Domain breakdown */}
      {domainEntries.length > 0 && (
        <div className="bg-slate-700/30 rounded p-2">
          <div className="text-xs text-gray-500 mb-1.5">Domain Breakdown</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono">
            {domainEntries.map(([domain, count]) => (
              <span key={domain} className="text-gray-300">
                <span className="text-gray-400">{domain}:</span> {fmtNum(count)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error details (if failed) */}
      {step.status === 'failed' && step.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded p-3">
          <div className="text-xs text-red-400 font-mono whitespace-pre-wrap">
            {step.error}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Panel 3: Human Review Queue
// ============================================================================

function ReviewQueuePanel({
  reviews,
  error,
  onApprove,
  onReject,
}: {
  reviews: Review[];
  error: string | null;
  onApprove: (reviewId: string) => void;
  onReject: (reviewId: string) => void;
}) {
  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        Human Review Queue
      </h2>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {reviews.length === 0 && !error ? (
        <div className="text-center py-8 text-gray-500">No pending reviews</div>
      ) : (
        <div className="space-y-3 overflow-y-auto max-h-[480px]">
          {reviews.map((review) => (
            <ReviewCard
              key={review.review_id}
              review={review}
              onApprove={() => onApprove(review.review_id)}
              onReject={() => onReject(review.review_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  onApprove,
  onReject,
}: {
  review: Review;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPending = review.status === 'pending';
  const tierColor = TIER_COLORS[review.tier] || TIER_COLORS[3];

  return (
    <div className="bg-slate-700/30 rounded-lg border border-slate-600/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={review.status} />
            <span className="text-white font-medium text-sm">{review.action}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
            <span className={`px-2 py-0.5 rounded ${tierColor} text-xs font-medium`}>
              Tier {review.tier}
            </span>
            <span>Requested by: {review.requested_by}</span>
            <span>{relativeTime(review.created_at)}</span>
          </div>

          {/* Context (expandable) */}
          {review.context && Object.keys(review.context).length > 0 && (
            <>
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors"
              >
                <Eye className="w-3 h-3" />
                {expanded ? 'Hide' : 'View'} context
              </button>
              {expanded && (
                <pre className="mt-2 bg-slate-800 rounded p-3 text-xs text-gray-300 font-mono overflow-x-auto max-h-48">
                  {JSON.stringify(review.context, null, 2)}
                </pre>
              )}
            </>
          )}

          {review.reason && (
            <div className="mt-2 text-xs text-gray-400">
              Reason: {review.reason}
            </div>
          )}
        </div>

        {isPending && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onApprove}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium rounded-lg border border-green-500/30 transition-colors"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              onClick={onReject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium rounded-lg border border-red-500/30 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function EngagementMonitor() {
  // Engagement state — selection defaults to the active engagement on page load.
  // Not persisted: page load always defers to the active engagement; in-session
  // selection is ephemeral. (Task: no last-user-selection, no first-in-list.)
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedEngagementId, setSelectedEngagementId] = useState<string | null>(null);
  const [engagementStatus, setEngagementStatus] = useState<EngagementStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [engagementsError, setEngagementsError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Run ledger state
  const [steps, setSteps] = useState<LedgerStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Reviews state
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsError, setReviewsError] = useState<string | null>(null);


  // Loading state
  const [initialLoading, setInitialLoading] = useState(true);

  // Polling ref
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sorted newest-first by created_at — mirrors Convergence's selector order.
  // Render-time only; does not mutate the fetched list.
  const sortedEngagements = useMemo(
    () => [...engagements].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [engagements],
  );

  // Determine the engagement to display in the ledger.
  // Pick the newest active (first in sortedEngagements) so the header and
  // EngagementStatusPanel agree when multiple engagements share state='active'.
  // No silent fallback: if no active and no valid in-session selection,
  // currentEngagementId is null and EngagementStatusPanel renders a fail-loud banner (A1).
  const activeEngagement = sortedEngagements.find(e => e.lifecycle_stage === 'active');
  const validSelectedId = selectedEngagementId && engagements.some(e => e.engagement_id === selectedEngagementId)
    ? selectedEngagementId
    : null;
  const currentEngagementId = validSelectedId || activeEngagement?.engagement_id || null;

  // Fetch engagements — Convergence returns a flat array.
  const fetchEngagements = useCallback(async () => {
    try {
      const data = await apiFetch<Engagement[]>(`/engagements?tenant_id=${encodeURIComponent(TENANT_ID)}`);
      setEngagements(data);
      setEngagementsError(null);
    } catch (err: any) {
      setEngagementsError(err.message);
      setEngagements([]);
    }
  }, []);

  // Fetch status — surface errors, don't silently null the status (A1).
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<EngagementStatus>('/status');
      setEngagementStatus(data);
      setStatusError(null);
    } catch (err: any) {
      setStatusError(err.message);
      setEngagementStatus(null);
    }
  }, []);

  // Fetch run ledger for current engagement
  const fetchLedger = useCallback(async () => {
    if (!currentEngagementId) {
      setSteps([]);
      return;
    }
    setStepsLoading(true);
    try {
      const data = await apiFetch<LedgerStep[]>(`/engagements/${currentEngagementId}/runs`);
      data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setSteps(data);
      setStepsError(null);
    } catch (err: any) {
      setStepsError(err.message);
    } finally {
      setStepsLoading(false);
    }
  }, [currentEngagementId]);

  // Fetch reviews
  const fetchReviews = useCallback(async () => {
    if (!currentEngagementId) return;
    try {
      const data = await apiFetch<Review[]>(`/engagements/${currentEngagementId}/reviews`);
      setReviews(data);
      setReviewsError(null);
    } catch (err: any) {
      setReviewsError(err.message);
    }
  }, [currentEngagementId]);

  // Initial load: fetch all panels.
  useEffect(() => {
    async function init() {
      await Promise.all([fetchEngagements(), fetchStatus(), fetchReviews()]);
      setInitialLoading(false);
    }
    init();
  }, [fetchEngagements, fetchStatus, fetchReviews]);

  // Fetch ledger when currentEngagementId changes
  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  // Auto-refresh polling
  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (!autoRefresh) return;

    const shouldPoll = steps.some(s => s.status === 'running' || s.status === 'pending') || autoRefresh;

    if (shouldPoll) {
      pollTimerRef.current = setInterval(() => {
        fetchEngagements();
        fetchStatus();
        fetchLedger();
        fetchReviews();
        // runStats polled less frequently — every 3rd tick (15s)
      }, 5000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [autoRefresh, steps, fetchEngagements, fetchStatus, fetchLedger, fetchReviews]);

  // Activate engagement (draft -> active)
  const handleActivateEngagement = async (engagementId: string) => {
    try {
      await apiFetch(`/engagements/${engagementId}`, {
        method: 'PATCH',
        body: JSON.stringify({ lifecycle_stage: 'active' }),
      });
      await fetchEngagements();
    } catch (err: any) {
      console.error('Failed to activate engagement:', err.message);
    }
  };

  // Create engagement — surface errors to the UI, not just console (A1).
  const handleCreateEngagement = async () => {
    setCreating(true);
    try {
      const result = await apiFetch<Engagement>('/engagements', {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: TENANT_ID,
          acquirer_entity_id: 'meridian',
          target_entity_id: 'cascadia',
          engagement_type: 'MA',
        }),
      });
      await fetchEngagements();
      setSelectedEngagementId(result.engagement_id);
      setCreateError(null);
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Approve review
  const handleApprove = async (reviewId: string) => {
    try {
      await apiFetch(`/reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved', approved_by: 'monitoring-ui' }),
      });
      await fetchReviews();
    } catch (err: any) {
      console.error('Failed to approve review:', err.message);
    }
  };

  // Reject review
  const handleReject = async (reviewId: string) => {
    const reason = window.prompt('Reason for rejection:');
    if (!reason) return;
    try {
      await apiFetch(`/reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected', rejected_by: 'monitoring-ui', reason }),
      });
      await fetchReviews();
    } catch (err: any) {
      console.error('Failed to reject review:', err.message);
    }
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading engagement monitor...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto space-y-4 p-6">
      {/* Header — matches MergePanel style */}
      <div className="shrink-0 px-6 py-2.5 border-b border-border bg-card/50">
        <div className="flex items-center gap-3 text-sm min-w-0">
          <h2 className="text-base font-semibold shrink-0">Engagement Monitor</h2>
        </div>
      </div>

      {/* Error banners — loud failures, no silent fallbacks (A1) */}
      {(engagementsError || statusError || createError) && (
        <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-red-200 text-sm space-y-1">
          {engagementsError && (
            <div>
              <span className="font-semibold text-red-100">Engagements:</span> {engagementsError}
            </div>
          )}
          {statusError && (
            <div>
              <span className="font-semibold text-red-100">Status:</span> {statusError}
            </div>
          )}
          {createError && (
            <div>
              <span className="font-semibold text-red-100">Create engagement:</span> {createError}
            </div>
          )}
        </div>
      )}

      {/* Panel 1: Engagement Status (compact) */}
      <EngagementStatusPanel
        engagements={sortedEngagements}
        engagementStatus={engagementStatus}
        onCreateEngagement={handleCreateEngagement}
        onActivateEngagement={handleActivateEngagement}
        creating={creating}
        selectedEngagementId={selectedEngagementId}
        onSelectEngagement={setSelectedEngagementId}
      />

      {/* Panel 2: Run Ledger */}
      <RunLedgerPanel
        steps={steps}
        loading={stepsLoading}
        error={stepsError}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)}
        onRefresh={() => {
          fetchLedger();
          fetchEngagements();
          fetchStatus();
          fetchReviews();
        }}
        engagementId={currentEngagementId}
      />

      {/* Panel 3: Human Review Queue */}
      <ReviewQueuePanel
        reviews={reviews}
        error={reviewsError}
        onApprove={handleApprove}
        onReject={handleReject}
      />

      {/* Footer */}
      <div className="text-center py-2 text-xs text-slate-600">
        {autoRefresh ? 'Auto-refreshing every 5s' : 'Auto-refresh paused'}
      </div>
    </div>
  );
}
