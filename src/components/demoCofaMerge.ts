// DEMO HARDCODE — NOT REAL DATA.
// COFA merge output rendered from constants regardless of backend
// gate or CoA presence. Server-side gate in
// farm/src/services/snapshot_triple_builder.py:147 and
// convergence COFA merge endpoint unchanged. Restore real wiring
// when Farm exposes business_model on POST /api/snapshots and
// CoA/GL generation is not gated by business_model value.

// Shape references live in MergePanel.tsx — import-free to avoid a
// circular frontend-only dependency.

// ── Conflict dataset ────────────────────────────────────────────────────────
// Representative M&A COFA output: a dozen account-mapping conflicts,
// policy divergences, revenue-rec timing adjustments. Dollar impacts
// aggregate to ~$34M EBITDA headwind + ~$9M tailwind adjustments.

export interface DemoConflictItem {
  conflict_id: string;
  concept: string;
  conflict_type: string;
  severity: string;
  description: string;
  dollar_impact: number;
  acquirer_treatment: string;
  target_treatment: string;
  resolution_status: string;
  resolution: string;
  resolved_by: string;
  resolved_at: string;
  resolution_notes: string;
  impact_area: string;
  revenue_impact: number | null;
  expense_impact: number | null;
  ebitda_impact: number | null;
  from_category: string;
  to_category: string;
}

const CONFLICTS: DemoConflictItem[] = [
  {
    conflict_id: "C-001",
    concept: "cogs.consultant_compensation",
    conflict_type: "classification",
    severity: "high",
    description: "Consultant comp: acquirer bundles benefits into COGS line; target splits benefits into opex.general_admin.",
    dollar_impact: 142.0,
    acquirer_treatment: "COGS includes benefits (bundled)",
    target_treatment: "COGS excludes benefits; benefits in G&A",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "margin",
    revenue_impact: 0,
    expense_impact: 142.0,
    ebitda_impact: 0,
    from_category: "cogs",
    to_category: "opex",
  },
  {
    conflict_id: "C-002",
    concept: "opex.sales_marketing",
    conflict_type: "classification",
    severity: "medium",
    description: "Target bundles Sales & Marketing into a single line; acquirer splits into opex.sales and opex.marketing.",
    dollar_impact: 86.0,
    acquirer_treatment: "Sales and Marketing reported separately",
    target_treatment: "Sales + Marketing combined",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "opex_presentation",
    revenue_impact: 0,
    expense_impact: 0,
    ebitda_impact: 0,
    from_category: "opex_bundled",
    to_category: "opex_split",
  },
  {
    conflict_id: "C-003",
    concept: "opex.recruiting",
    conflict_type: "capitalization",
    severity: "high",
    description: "Target capitalizes a portion of recruiting costs (18-month amortization); acquirer fully expenses.",
    dollar_impact: 64.0,
    acquirer_treatment: "Fully expensed in period",
    target_treatment: "Capitalized; 18-month amortization",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "ebitda",
    revenue_impact: 0,
    expense_impact: -64.0,
    ebitda_impact: -64.0,
    from_category: "opex_capex",
    to_category: "opex_expense",
  },
  {
    conflict_id: "C-004",
    concept: "pnl.depreciation",
    conflict_type: "depreciation_schedule",
    severity: "medium",
    description: "Acquirer uses straight-line 5yr on PP&E; target uses accelerated (200% declining balance over 3yr).",
    dollar_impact: 48.0,
    acquirer_treatment: "Straight-line, 5 years",
    target_treatment: "Accelerated (200% DDB), 3 years",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "ebitda",
    revenue_impact: 0,
    expense_impact: 48.0,
    ebitda_impact: -48.0,
    from_category: "depreciation_accelerated",
    to_category: "depreciation_straight_line",
  },
  {
    conflict_id: "C-005",
    concept: "revenue.recognition_timing",
    conflict_type: "revenue_recognition",
    severity: "high",
    description: "Target recognizes fixed-fee project revenue at milestone completion; acquirer uses percentage-of-completion.",
    dollar_impact: 91.0,
    acquirer_treatment: "Percentage-of-completion (smoother)",
    target_treatment: "Milestone completion (lumpy)",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "revenue",
    revenue_impact: 91.0,
    expense_impact: 0,
    ebitda_impact: 91.0,
    from_category: "revenue_milestone",
    to_category: "revenue_poc",
  },
  {
    conflict_id: "C-006",
    concept: "asset.intangibles.software",
    conflict_type: "capitalization",
    severity: "medium",
    description: "Target capitalizes internal software development; acquirer expenses it under R&D.",
    dollar_impact: 32.0,
    acquirer_treatment: "Expensed under R&D",
    target_treatment: "Capitalized to intangibles",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "ebitda",
    revenue_impact: 0,
    expense_impact: -32.0,
    ebitda_impact: -32.0,
    from_category: "asset_capitalized",
    to_category: "opex_expense",
  },
  {
    conflict_id: "C-007",
    concept: "opex.it_subscription",
    conflict_type: "classification",
    severity: "low",
    description: "Acquirer books SaaS subscriptions under opex.technology; target splits across multiple cost centers.",
    dollar_impact: 21.0,
    acquirer_treatment: "Consolidated under Technology",
    target_treatment: "Allocated across business units",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "opex_presentation",
    revenue_impact: 0,
    expense_impact: 0,
    ebitda_impact: 0,
    from_category: "opex_allocated",
    to_category: "opex_consolidated",
  },
  {
    conflict_id: "C-008",
    concept: "liability.current.deferred_revenue",
    conflict_type: "timing",
    severity: "medium",
    description: "Target accrues deferred revenue gross; acquirer nets against unbilled receivables.",
    dollar_impact: 57.0,
    acquirer_treatment: "Net of unbilled AR",
    target_treatment: "Gross deferred liability",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "balance_sheet",
    revenue_impact: 0,
    expense_impact: 0,
    ebitda_impact: 0,
    from_category: "liability_gross",
    to_category: "liability_net",
  },
  {
    conflict_id: "C-009",
    concept: "opex.bench_cost",
    conflict_type: "classification",
    severity: "medium",
    description: "Acquirer tracks bench cost as a separate COGS line; target bundles into consultant_comp.",
    dollar_impact: 45.0,
    acquirer_treatment: "Separate COGS line (bench)",
    target_treatment: "Bundled into consultant comp",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "margin",
    revenue_impact: 0,
    expense_impact: 0,
    ebitda_impact: 0,
    from_category: "cogs_bundled",
    to_category: "cogs_split",
  },
  {
    conflict_id: "C-010",
    concept: "opex.legal_settlement",
    conflict_type: "classification",
    severity: "high",
    description: "One-time IP litigation settlement: acquirer booked to opex; target capitalized as contingent liability.",
    dollar_impact: 48.0,
    acquirer_treatment: "Booked to opex (one-time)",
    target_treatment: "Contingent liability on BS",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "ebitda",
    revenue_impact: 0,
    expense_impact: 48.0,
    ebitda_impact: -48.0,
    from_category: "opex_onetime",
    to_category: "liability_contingent",
  },
  {
    conflict_id: "C-011",
    concept: "asset.current.prepaid_expenses",
    conflict_type: "timing",
    severity: "low",
    description: "Prepaid insurance amortization cycle: acquirer 12-month straight-line; target quarterly recognition.",
    dollar_impact: 14.0,
    acquirer_treatment: "Monthly straight-line",
    target_treatment: "Quarterly recognition",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "working_capital",
    revenue_impact: 0,
    expense_impact: 0,
    ebitda_impact: 0,
    from_category: "prepaid_quarterly",
    to_category: "prepaid_monthly",
  },
  {
    conflict_id: "C-012",
    concept: "revenue.by_customer.rebate",
    conflict_type: "revenue_recognition",
    severity: "medium",
    description: "Vendor rebates: acquirer accrues on earn basis; target recognizes at cash receipt.",
    dollar_impact: 17.0,
    acquirer_treatment: "Accrual (earn basis)",
    target_treatment: "Cash receipt",
    resolution_status: "pending",
    resolution: "",
    resolved_by: "",
    resolved_at: "",
    resolution_notes: "",
    impact_area: "revenue",
    revenue_impact: 17.0,
    expense_impact: 0,
    ebitda_impact: 17.0,
    from_category: "revenue_cash",
    to_category: "revenue_accrual",
  },
];

// category_summary bucketed by conflict_type. Matches the shape
// MergePanel expects: by_type[type] = { count, total_dollar_impact,
// revenue_impact, expense_impact, ebitda_impact, conflicts, conflict_details,
// reclassifications }
function _bucketByType(rows: DemoConflictItem[]) {
  const by_type: Record<string, {
    count: number;
    total_dollar_impact: number;
    revenue_impact: number;
    expense_impact: number;
    ebitda_impact: number;
    conflicts: string[];
    conflict_details: {
      conflict_id: string;
      description: string;
      dollar_impact: number;
      revenue_impact: number;
      expense_impact: number;
      ebitda_impact: number;
      impact_area: string;
      severity: string;
      acquirer_treatment: string;
      target_treatment: string;
      resolution_status: string;
      from_category: string;
      to_category: string;
    }[];
    reclassifications: {
      conflict_id: string;
      from_category: string;
      to_category: string;
      amount: number;
      description: string;
    }[];
  }> = {};

  for (const c of rows) {
    const t = c.conflict_type;
    if (!by_type[t]) {
      by_type[t] = {
        count: 0,
        total_dollar_impact: 0,
        revenue_impact: 0,
        expense_impact: 0,
        ebitda_impact: 0,
        conflicts: [],
        conflict_details: [],
        reclassifications: [],
      };
    }
    const b = by_type[t];
    b.count += 1;
    b.total_dollar_impact += c.dollar_impact;
    b.revenue_impact += c.revenue_impact ?? 0;
    b.expense_impact += c.expense_impact ?? 0;
    b.ebitda_impact += c.ebitda_impact ?? 0;
    b.conflicts.push(c.conflict_id);
    b.conflict_details.push({
      conflict_id: c.conflict_id,
      description: c.description,
      dollar_impact: c.dollar_impact,
      revenue_impact: c.revenue_impact ?? 0,
      expense_impact: c.expense_impact ?? 0,
      ebitda_impact: c.ebitda_impact ?? 0,
      impact_area: c.impact_area,
      severity: c.severity,
      acquirer_treatment: c.acquirer_treatment,
      target_treatment: c.target_treatment,
      resolution_status: c.resolution_status,
      from_category: c.from_category,
      to_category: c.to_category,
    });
    b.reclassifications.push({
      conflict_id: c.conflict_id,
      from_category: c.from_category,
      to_category: c.to_category,
      amount: c.dollar_impact,
      description: c.description,
    });
  }

  const combined_impact = rows.reduce(
    (acc, c) => ({
      revenue: acc.revenue + (c.revenue_impact ?? 0),
      expenses: acc.expenses + (c.expense_impact ?? 0),
      ebitda: acc.ebitda + (c.ebitda_impact ?? 0),
    }),
    { revenue: 0, expenses: 0, ebitda: 0 },
  );

  return { by_type, combined_impact };
}

export const DEMO_CONFLICT_DATA = {
  conflicts: CONFLICTS,
  summary: {
    total: CONFLICTS.length,
    pending: CONFLICTS.length,
    resolved: 0,
  },
  category_summary: _bucketByType(CONFLICTS),
};

// ── Post-merge overview override ────────────────────────────────────────────
// Shiny account-mapping counts and policy metadata. MergePanel renders
// overview.entities[].cofa_count, orphans.{acquirer,target}_coa_total /
// _mapped / _unmatched_count, and policy_sources.
//
// Fields are merged into the existing MergeData on demo merge completion
// so entity ids / display_names come from the backend fetch.

export const DEMO_POST_MERGE_OVERVIEW = {
  orphans: {
    show_section: true,
    acquirer_coa_total: 247,
    acquirer_mapped: 238,
    acquirer_unmatched_count: 9,
    target_coa_total: 203,
    target_mapped: 196,
    target_unmatched_count: 7,
    message: "16 orphan accounts flagged for HITL review.",
  },
  matches: {
    has_matches: true,
    message: "238 of 247 acquirer accounts mapped; 196 of 203 target accounts mapped.",
  },
  overview_cofa_count_acquirer: 247,
  overview_cofa_count_target: 203,
  total_cofa_count: 450,
  policy_sources: {
    revenue_recognition: "entity" as const,
    classification: "entity" as const,
    capitalization: "entity" as const,
    depreciation: "entity" as const,
  },
  financial_summary: [
    { label: "Reported EBITDA (acquirer)", acquirer: 613.0, target: null, consolidated: null, format: "currency" as const },
    { label: "Reported EBITDA (target)", acquirer: null, target: 487.0, consolidated: null, format: "currency" as const },
    { label: "Conflict adjustments — revenue", acquirer: null, target: null, consolidated: 108.0, is_derived: true, format: "currency" as const },
    { label: "Conflict adjustments — expense", acquirer: null, target: null, consolidated: 142.0, is_derived: true, format: "currency" as const },
    { label: "Net EBITDA impact of conflicts", acquirer: null, target: null, consolidated: -84.0, is_derived: true, format: "currency" as const },
    { label: "Combined EBITDA (post-reconciliation)", acquirer: null, target: null, consolidated: 1016.0, is_derived: true, format: "currency" as const },
  ],
};

export const DEMO_MERGE_MAPPING_COUNT = 434;
export const DEMO_MERGE_FAKE_LATENCY_S = 8;

// ── DEMO JITTER — deterministic per engagement_id, ±10%, not real data. ─────
//
// Separate copy of the same helper used in report-portal/demoReportData.ts —
// co-located with the constants per the demo-jitter rule.

type RoundMode = 'int' | 'one' | 'two';

function _hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function demoJitter(value: number, engagementId: string, field: string, mode: RoundMode = 'one'): number {
  if (!engagementId || !Number.isFinite(value) || value === 0) return value;
  const factor = 0.9 + (_hash32(`${engagementId}::${field}`) / 4294967295) * 0.2;
  const j = value * factor;
  if (mode === 'int') return Math.round(j);
  if (mode === 'one') return Math.round(j * 10) / 10;
  return Math.round(j * 100) / 100;
}

// ── Jittered getters ──────────────────────────────────────────────────────

export function getDemoConflictData(engagementId: string) {
  const jitterRow = (c: DemoConflictItem, i: number): DemoConflictItem => {
    const p = `c.${i}`;
    return {
      ...c,
      dollar_impact: demoJitter(c.dollar_impact, engagementId, `${p}.dollar`, 'one'),
      revenue_impact: c.revenue_impact !== null ? demoJitter(c.revenue_impact, engagementId, `${p}.rev`, 'one') : null,
      expense_impact: c.expense_impact !== null ? demoJitter(c.expense_impact, engagementId, `${p}.exp`, 'one') : null,
      ebitda_impact: c.ebitda_impact !== null ? demoJitter(c.ebitda_impact, engagementId, `${p}.ebitda`, 'one') : null,
    };
  };

  const conflicts = CONFLICTS.map(jitterRow);
  const category_summary = _bucketByType(conflicts);
  return {
    conflicts,
    summary: {
      total: conflicts.length,
      pending: conflicts.length,
      resolved: 0,
    },
    category_summary,
  };
}

export function getDemoPostMergeOverview(engagementId: string) {
  const jI = (v: number, f: string) => demoJitter(v, engagementId, f, 'int');
  const j1 = (v: number, f: string) => demoJitter(v, engagementId, f, 'one');
  const base = DEMO_POST_MERGE_OVERVIEW;
  const acquirer_coa = jI(base.orphans.acquirer_coa_total, 'o.acqTotal');
  const acquirer_mapped = Math.min(acquirer_coa, jI(base.orphans.acquirer_mapped, 'o.acqMapped'));
  const target_coa = jI(base.orphans.target_coa_total, 'o.tgtTotal');
  const target_mapped = Math.min(target_coa, jI(base.orphans.target_mapped, 'o.tgtMapped'));
  return {
    ...base,
    orphans: {
      ...base.orphans,
      acquirer_coa_total: acquirer_coa,
      acquirer_mapped,
      acquirer_unmatched_count: Math.max(0, acquirer_coa - acquirer_mapped),
      target_coa_total: target_coa,
      target_mapped,
      target_unmatched_count: Math.max(0, target_coa - target_mapped),
    },
    overview_cofa_count_acquirer: acquirer_coa,
    overview_cofa_count_target: target_coa,
    total_cofa_count: acquirer_coa + target_coa,
    financial_summary: base.financial_summary.map((m, i) => ({
      ...m,
      acquirer: m.acquirer !== null ? j1(m.acquirer, `fs.${i}.a`) : null,
      target: m.target !== null ? j1(m.target, `fs.${i}.t`) : null,
      consolidated: m.consolidated !== null ? j1(m.consolidated, `fs.${i}.c`) : null,
    })),
  };
}

export function getDemoMergeMappingCount(engagementId: string): number {
  return demoJitter(DEMO_MERGE_MAPPING_COUNT, engagementId, 'mapping.count', 'int');
}
