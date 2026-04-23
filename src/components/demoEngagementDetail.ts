// DEMO HARDCODE — NOT REAL DATA.
// EngagementDetail overview (Run Ledger + Human Review Queue) renders
// canned rows regardless of backend state. The demo COFA merge bypasses
// the backend and writes no run_ledger rows; without this hardcode,
// the overview appears empty for every demo-merged engagement. Restore
// real wiring when the demo COFA merge writes real ledger entries and
// human_reviews is populated by a real HITL surface.

// Shape references live in EngagementDetail.tsx — import-free to avoid a
// circular frontend-only dependency.

export interface DemoLedgerStep {
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

export interface DemoReview {
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

// ── Jitter helper (matches demoReportData.ts / demoCofaMerge.ts) ───────────

function _hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitterFactor(engagementId: string, field: string): number {
  if (!engagementId) return 1;
  return 0.9 + (_hash32(`${engagementId}::${field}`) / 4294967295) * 0.2;
}

// Produce a timestamp offset N minutes before a reference time, jittered ±10%.
function minutesBeforeTs(refMs: number, minutesBefore: number, engagementId: string, field: string): string {
  const jittered = minutesBefore * jitterFactor(engagementId, field);
  return new Date(refMs - jittered * 60 * 1000).toISOString();
}

// ── Canned ledger: 5 steps spanning engagement_init → cofa_merge ───────────
// Each step has a monotonic start (minutesAgo) and a positive duration
// (minutes). End = start - duration. Both jittered ±10% independently but
// duration stays positive by construction, so no negative-duration rows.

export function getDemoLedgerSteps(engagementId: string): DemoLedgerStep[] {
  const nowMs = Date.now();

  interface StepDef {
    step_name: string;
    startMinAgo: number;
    durationMin: number;
    outputs_ref: string | null;
  }
  // Ordered newest-first (matches EngagementDetail's sort by created_at DESC).
  const defs: StepDef[] = [
    { step_name: 'cofa_merge',      startMinAgo: 9,  durationMin: 8,  outputs_ref: 'convergence_triples:cofa_run_id=demo' },
    { step_name: 'entity_resolver', startMinAgo: 24, durationMin: 3,  outputs_ref: 'resolver_decisions:run=demo' },
    { step_name: 'ingest_target',   startMinAgo: 35, durationMin: 14, outputs_ref: 'convergence_triples:entity=target' },
    { step_name: 'ingest_acquirer', startMinAgo: 52, durationMin: 13, outputs_ref: 'convergence_triples:entity=acquirer' },
    { step_name: 'engagement_init', startMinAgo: 68, durationMin: 1,  outputs_ref: 'engagements:engagement_id=' + engagementId },
  ];

  return defs.map((d, i) => {
    const startMinJitter = d.startMinAgo * jitterFactor(engagementId, `${d.step_name}.start`);
    const durMinJitter = Math.max(0.1, d.durationMin * jitterFactor(engagementId, `${d.step_name}.dur`));
    const startMs = nowMs - startMinJitter * 60_000;
    const endMs = startMs + durMinJitter * 60_000;
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    const createdIso = new Date(startMs - 6_000).toISOString();
    return {
      step_id: `demo-${engagementId.slice(0, 8)}-${i}`,
      engagement_id: engagementId,
      step_name: d.step_name,
      status: 'complete',
      idempotency_key: `${engagementId}:${d.step_name}:demo`,
      inputs_hash: _hash32(`${engagementId}:${d.step_name}`).toString(16).slice(0, 16),
      outputs_ref: d.outputs_ref,
      error: null,
      started_at: startIso,
      completed_at: endIso,
      created_at: createdIso,
    };
  });
}

// ── Canned human review queue ─────────────────────────────────────────────
// Two pending tier-3 items — one CoA mapping ambiguity, one entity-resolver
// collision — plus one resolved tier-2 for operator context.

export function getDemoReviews(engagementId: string): DemoReview[] {
  const nowMs = Date.now();
  const mk = (
    i: number,
    action: string,
    tier: number,
    status: string,
    requested_by: string,
    reason: string | null,
    minutesAgo: number,
    approved_by: string | null = null,
    rejected_by: string | null = null,
  ): DemoReview => ({
    review_id: `demo-review-${engagementId.slice(0, 8)}-${i}`,
    engagement_id: engagementId,
    action,
    context: {},
    tier,
    status,
    requested_by,
    approved_by,
    rejected_by,
    reason,
    created_at: minutesBeforeTs(nowMs, minutesAgo, engagementId, `review.${i}.created`),
  });

  return [
    mk(0, 'cofa_conflict_resolution', 3, 'pending', 'cofa_merge',
       'Procurement rebates: vendor rebate timing differs between acquirer (accrual) and target (cash receipt). Materiality above $1M threshold.', 5),
    mk(1, 'entity_overlap_review', 3, 'pending', 'entity_resolver',
       '2 customer records flagged as potential duplicates pending operator confirmation (tax_id match, name similarity 0.83).', 11),
    mk(2, 'policy_assignment', 2, 'approved', 'mai',
       'Industry default accounting policy assigned in absence of uploaded policy document.', 37, 'operator'),
  ];
}
