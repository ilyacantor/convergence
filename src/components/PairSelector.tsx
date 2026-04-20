import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react';

interface CatalogTenant {
  tenant_id: string;
  template_id: string;
  display_name: string;
  industry: string;
  revenue_scale: string;
  domain_coverage: string[];
}

interface CatalogResponse {
  passing_tenants: CatalogTenant[];
  existing_engagements: { engagement_id: string; acquirer_tenant_id: string; target_tenant_id: string }[];
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

function TenantCard({
  tenant,
  selected,
  disabled,
  onSelect,
  label,
}: {
  tenant: CatalogTenant;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  label: 'Acquirer' | 'Target';
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        selected
          ? 'border-cyan-500 bg-cyan-500/10'
          : disabled
            ? 'border-slate-700/30 bg-slate-800/30 opacity-50 cursor-not-allowed'
            : 'border-slate-700/50 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-700/30 cursor-pointer'
      }`}
      data-testid={`catalog-tenant-${tenant.tenant_id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-white font-medium text-sm">{tenant.display_name}</span>
        {selected && (
          <span className="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full">
            {label}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>{tenant.industry}</span>
        <span>{tenant.revenue_scale}</span>
      </div>
      {tenant.domain_coverage.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tenant.domain_coverage.map((d) => (
            <span
              key={d}
              className="text-xs bg-slate-700/50 text-gray-400 px-1.5 py-0.5 rounded"
            >
              {d}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export default function PairSelector() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acquirerTid, setAcquirerTid] = useState<string | null>(null);
  const [targetTid, setTargetTid] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchCatalog = useCallback(async () => {
    try {
      const data = await apiFetch<CatalogResponse>('/catalog');
      setCatalog(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const existingPair = catalog?.existing_engagements.find(
    (e) => e.acquirer_tenant_id === acquirerTid && e.target_tenant_id === targetTid,
  );

  const handleCreate = async () => {
    if (!acquirerTid || !targetTid) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await apiFetch<{ engagement_id: string }>('/engagements', {
        method: 'POST',
        body: JSON.stringify({
          acquirer_tenant_id: acquirerTid,
          target_tenant_id: targetTid,
          engagement_type: 'MA',
        }),
      });
      navigate(`/engagements/${result.engagement_id}`);
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-sm">Loading AOS catalog...</span>
        </div>
      </div>
    );
  }

  const tenants = catalog?.passing_tenants || [];

  return (
    <div className="max-w-[900px] mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/engagements')}
          className="p-2 text-gray-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-semibold text-white">New Engagement</h1>
      </div>

      {error && (
        <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {tenants.length === 0 && !error ? (
        <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-8 text-center">
          <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-3" />
          <p className="text-amber-200 text-sm mb-1">No AOS tenants pass the contract check.</p>
          <p className="text-amber-400/60 text-xs">
            Farm must generate tenants with namespace_type and business_record properties before pair selection is available.
          </p>
        </div>
      ) : (
        <>
          <p className="text-gray-400 text-sm">
            Select two AOS tenants to create a Convergence engagement. Each tenant must pass the AOS output contract check.
          </p>

          {/* Two-column selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Acquirer column */}
            <div>
              <h2 className="text-sm font-medium text-gray-300 mb-3">Acquirer</h2>
              <div className="space-y-2">
                {tenants.map((t) => (
                  <TenantCard
                    key={`acq-${t.tenant_id}`}
                    tenant={t}
                    selected={acquirerTid === t.tenant_id}
                    disabled={targetTid === t.tenant_id}
                    onSelect={() => setAcquirerTid(acquirerTid === t.tenant_id ? null : t.tenant_id)}
                    label="Acquirer"
                  />
                ))}
              </div>
            </div>

            {/* Target column */}
            <div>
              <h2 className="text-sm font-medium text-gray-300 mb-3">Target</h2>
              <div className="space-y-2">
                {tenants.map((t) => (
                  <TenantCard
                    key={`tgt-${t.tenant_id}`}
                    tenant={t}
                    selected={targetTid === t.tenant_id}
                    disabled={acquirerTid === t.tenant_id}
                    onSelect={() => setTargetTid(targetTid === t.tenant_id ? null : t.tenant_id)}
                    label="Target"
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Existing engagement warning */}
          {existingPair && (
            <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-3 flex items-center gap-2 text-amber-200 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              This pair already has an engagement ({existingPair.engagement_id.slice(0, 8)}). You can still create a new one.
            </div>
          )}

          {createError && (
            <div className="bg-red-950/60 border border-red-800 rounded-lg px-4 py-3 text-red-200 text-sm">
              {createError}
            </div>
          )}

          {/* Create button */}
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!acquirerTid || !targetTid || creating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              {creating ? 'Creating...' : 'Create Engagement'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
