import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FileText,
  BarChart3,
  GitMerge,
  Layers,
} from 'lucide-react';
import ResolutionsTab from './ResolutionsTab';

interface Engagement {
  engagement_id: string;
  acquirer_entity_id: string;
  target_entity_id: string;
  acquirer_tenant_id?: string;
  target_tenant_id?: string;
  engagement_short_name: string | null;
  tenant_id: string;
  engagement_type: string;
  lifecycle_stage: string;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface LedgerStep {
  step_id: string;
  engagement_id: string;
  step_name: string;
  status: string;
  idempotency_key: string;
  inputs_hash: string;
  outputs_ref: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
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

const STAGE_COLORS: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  paused: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  archived: 'bg-gray-600/20 text-gray-500 border-gray-600/30',
  completed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  complete: 'bg-green-500/20 text-green-400 border-green-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  approved: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function StatusBadge({ status, pulse }: { status: string; pulse?: boolean }) {
  const cls = STATUS_COLORS[status] || STAGE_COLORS[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {status}
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

type TabId = 'overview' | 'resolutions' | 'cofa' | 'reports';

const TABS: { id: TabId; label: string; icon: typeof Layers }[] = [
  { id: 'overview', label: 'Overview', icon: Layers },
  { id: 'resolutions', label: 'Resolutions', icon: GitMerge },
  { id: 'cofa', label: 'COFA', icon: FileText },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

const TIER_COLORS: Record<number, string> = {
  1: 'bg-green-500/20 text-green-400',
  2: 'bg-blue-500/20 text-blue-400',
  3: 'bg-amber-500/20 text-amber-400',
  4: 'bg-red-500/20 text-red-400',
};

export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [steps, setSteps] = useState<LedgerStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState<string | null>(null);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const fetchEngagement = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<Engagement>(`/engagements/${id}`);
      setEngagement(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchLedger = useCallback(async () => {
    if (!id) return;
    setStepsLoading(true);
    try {
      const data = await apiFetch<LedgerStep[]>(`/engagements/${id}/runs`);
      data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setSteps(data);
      setStepsError(null);
    } catch (err: any) {
      setStepsError(err.message);
    } finally {
      setStepsLoading(false);
    }
  }, [id]);

  const fetchReviews = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<Review[]>(`/engagements/${id}/reviews`);
      setReviews(data);
      setReviewsError(null);
    } catch (err: any) {
      setReviewsError(err.message);
    }
  }, [id]);

  useEffect(() => {
    fetchEngagement();
    fetchLedger();
    fetchReviews();
  }, [fetchEngagement, fetchLedger, fetchReviews]);

  const handlePromote = async () => {
    if (!id) return;
    try {
      await apiFetch(`/engagements/${id}/promote`, { method: 'POST' });
      await fetchEngagement();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApproveReview = async (reviewId: string) => {
    try {
      await apiFetch(`/reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved', approved_by: 'convergence-ui' }),
      });
      await fetchReviews();
    } catch (err: any) {
      setReviewsError(err.message);
    }
  };

  const handleRejectReview = async (reviewId: string) => {
    const reason = window.prompt('Reason for rejection:');
    if (!reason) return;
    try {
      await apiFetch(`/reviews/${reviewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected', rejected_by: 'convergence-ui', reason }),
      });
      await fetchReviews();
    } catch (err: any) {
      setReviewsError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading engagement...</span>
        </div>
      </div>
    );
  }

  if (error && !engagement) {
    return (
      <div className="max-w-[1100px] mx-auto p-6">
        <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
        <button
          onClick={() => navigate('/engagements')}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to engagements
        </button>
      </div>
    );
  }

  if (!engagement) return null;

  return (
    <div className="max-w-[1100px] mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/engagements')}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-white flex items-center gap-2">
              {engagement.engagement_short_name || `${engagement.acquirer_entity_id} + ${engagement.target_entity_id}`}
              <StatusBadge status={engagement.lifecycle_stage} pulse={engagement.lifecycle_stage === 'active'} />
            </h1>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
              <span>{engagement.acquirer_entity_id} &harr; {engagement.target_entity_id}</span>
              <span>{engagement.engagement_type}</span>
              <span>Created {relativeTime(engagement.created_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {engagement.lifecycle_stage === 'draft' && (
            <button
              onClick={handlePromote}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Activate
            </button>
          )}
          <button
            onClick={() => { fetchEngagement(); fetchLedger(); fetchReviews(); }}
            className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-700/50">
        {TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button
            key={tabId}
            onClick={() => setActiveTab(tabId)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tabId
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
            }`}
            data-testid={`tab-${tabId}`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Run Ledger */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-400" />
                Run Ledger
              </h2>
              <button
                onClick={fetchLedger}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${stepsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {stepsError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-red-400 text-sm">
                {stepsError}
              </div>
            )}

            {steps.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">No steps recorded</div>
            ) : (
              <div className="overflow-auto max-h-[320px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800 z-10">
                    <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-slate-700/50">
                      <th className="text-left py-2 px-3">Step</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Started</th>
                      <th className="text-left py-2 px-3">Duration</th>
                      <th className="text-left py-2 px-3">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((step) => (
                      <Fragment key={step.step_id}>
                        <tr
                          className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors cursor-pointer"
                          onClick={() => setExpandedSteps((prev) => {
                            const next = new Set(prev);
                            if (next.has(step.step_id)) next.delete(step.step_id);
                            else next.add(step.step_id);
                            return next;
                          })}
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              {expandedSteps.has(step.step_id)
                                ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                                : <ChevronRight className="w-3.5 h-3.5 text-gray-500" />}
                              <span className="text-white font-medium">{step.step_name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={step.status} pulse={step.status === 'running'} />
                          </td>
                          <td className="py-2.5 px-3 text-gray-400 font-mono text-xs">{formatTime(step.started_at)}</td>
                          <td className="py-2.5 px-3 text-gray-400">{durationBetween(step.started_at, step.completed_at)}</td>
                          <td className="py-2.5 px-3">
                            {step.error ? (
                              <span className="text-red-400 text-xs truncate block max-w-[200px]" title={step.error}>
                                {step.error}
                              </span>
                            ) : (
                              <span className="text-gray-600">{'\u2014'}</span>
                            )}
                          </td>
                        </tr>
                        {expandedSteps.has(step.step_id) && step.error && (
                          <tr className="bg-slate-700/10">
                            <td colSpan={5} className="px-8 py-3">
                              <div className="bg-red-500/10 border border-red-500/20 rounded p-3 text-xs text-red-400 font-mono whitespace-pre-wrap">
                                {step.error}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Human Review Queue */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
            <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Human Review Queue
            </h2>

            {reviewsError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3 text-red-400 text-sm">
                {reviewsError}
              </div>
            )}

            {reviews.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">No pending reviews</div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {reviews.map((review) => {
                  const isPending = review.status === 'pending';
                  const tierColor = TIER_COLORS[review.tier] || TIER_COLORS[3];
                  return (
                    <div key={review.review_id} className="bg-slate-700/30 rounded-lg border border-slate-600/30 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={review.status} />
                            <span className="text-white font-medium text-sm">{review.action}</span>
                            <span className={`px-2 py-0.5 rounded ${tierColor} text-xs font-medium`}>
                              Tier {review.tier}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            <span>By {review.requested_by}</span>
                            <span className="mx-2">&middot;</span>
                            <span>{relativeTime(review.created_at)}</span>
                          </div>
                          {review.reason && (
                            <div className="mt-1 text-xs text-gray-400">Reason: {review.reason}</div>
                          )}
                        </div>
                        {isPending && (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => handleApproveReview(review.review_id)}
                              className="px-2.5 py-1 text-xs bg-green-600/20 text-green-400 border border-green-500/30 rounded hover:bg-green-600/30 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleRejectReview(review.review_id)}
                              className="px-2.5 py-1 text-xs bg-red-600/20 text-red-400 border border-red-500/30 rounded hover:bg-red-600/30 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'resolutions' && (
        <ResolutionsTab engagementId={engagement.engagement_id} />
      )}

      {activeTab === 'cofa' && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
          <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            COFA Merge
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Chart of Accounts merge workspace for this engagement.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Open MergePanel
          </Link>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6">
          <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-purple-400" />
            Reports
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Convergence analysis reports for this engagement.
          </p>
          <Link
            to={'/reports?engagement_id=' + engagement.engagement_id}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Open Report Portal
          </Link>
        </div>
      )}
    </div>
  );
}
