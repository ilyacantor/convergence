import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react';

interface CatalogEntity {
  tenant_id: string;
  entity_id: string;
  display_name: string;
  triple_count: number;
  domain_coverage: string[];
  contract_passed: boolean;
}

interface CatalogResponse {
  passing_entities: CatalogEntity[];
  existing_engagements: { engagement_id: string; acquirer_entity_id: string; target_entity_id: string }[];
  empty_reason?: string;
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

function EntityCard({
  entity,
  selected,
  disabled,
  onSelect,
  label,
}: {
  entity: CatalogEntity;
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
      data-testid={`catalog-entity-${entity.entity_id}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-white font-medium text-sm">{entity.display_name}</span>
        {selected && (
          <span className="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full">
            {label}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>{entity.entity_id}</span>
        <span>{entity.triple_count.toLocaleString()} triples</span>
      </div>
      {entity.domain_coverage.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {entity.domain_coverage.map((d) => (
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
  const [acquirerEid, setAcquirerEid] = useState<string | null>(null);
  const [targetEid, setTargetEid] = useState<string | null>(null);
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

  const entities = catalog?.passing_entities || [];

  const selectedAcquirer = entities.find((e) => e.entity_id === acquirerEid);
  const selectedTarget = entities.find((e) => e.entity_id === targetEid);

  const existingPair = catalog?.existing_engagements.find(
    (e) => e.acquirer_entity_id === acquirerEid && e.target_entity_id === targetEid,
  );

  const handleCreate = async () => {
    if (!acquirerEid || !targetEid || !selectedAcquirer) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await apiFetch<{ engagement_id: string }>('/engagements', {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: selectedAcquirer.tenant_id,
          acquirer_entity_id: acquirerEid,
          target_entity_id: targetEid,
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
          <span className="text-gray-400 text-sm">Loading entity catalog...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto p-6 space-y-6">
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

      {entities.length === 0 && !error ? (
        <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-8 text-center">
          <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-3" />
          <p className="text-amber-200 text-sm mb-1">No entities available for pair selection.</p>
          <p className="text-amber-400/60 text-xs">
            {catalog?.empty_reason ||
              'No shape-compliant entities in convergence_triples. Run: python scripts/sync_entity_catalog.py'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-gray-400 text-sm">
            Select two entities to create a Convergence engagement. Each entity must pass the contract check.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-sm font-medium text-gray-300 mb-3">Acquirer</h2>
              <div className="space-y-2">
                {entities.map((e) => (
                  <EntityCard
                    key={`acq-${e.entity_id}`}
                    entity={e}
                    selected={acquirerEid === e.entity_id}
                    disabled={targetEid === e.entity_id}
                    onSelect={() => setAcquirerEid(acquirerEid === e.entity_id ? null : e.entity_id)}
                    label="Acquirer"
                  />
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-medium text-gray-300 mb-3">Target</h2>
              <div className="space-y-2">
                {entities.map((e) => (
                  <EntityCard
                    key={`tgt-${e.entity_id}`}
                    entity={e}
                    selected={targetEid === e.entity_id}
                    disabled={acquirerEid === e.entity_id}
                    onSelect={() => setTargetEid(targetEid === e.entity_id ? null : e.entity_id)}
                    label="Target"
                  />
                ))}
              </div>
            </div>
          </div>

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

          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={!acquirerEid || !targetEid || creating}
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
