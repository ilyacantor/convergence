export interface ReportLine {
  id: string
  name: string
  amount: number | null
  level: number
  isTotal?: boolean
  isHeader?: boolean
  isSub?: boolean
  bold?: boolean
  isFinal?: boolean
  isPercent?: boolean
  drillable?: boolean
  highlight?: boolean
}

export interface ReportData {
  lines: ReportLine[]
  metadata: {
    entity: string
    quarter: string
    segment: string | null
    periodType: 'actual' | 'forecast'
    unit?: string
  }
}

export interface DrillThroughItem {
  name: string
  revenue: number
  children: boolean
  customers?: number
  projects?: number
}

export type StatementTab = 'pl' | 'bs' | 'socf' | 'drill'

export type ReportVariant =
  | 'full_year_act_vs_py'
  | 'quarterly_act_vs_py'
  | 'full_year_cf_vs_py_act'
  | 'quarterly_cf_vs_py'

export interface FinancialStatementLineItem {
  label: string
  key: string
  indent: number
  format: 'currency' | 'percent'
  is_subtotal: boolean
  values: Record<string, number | null>
}

export interface FinancialStatementData {
  title: string
  entity: string
  periods: string[]
  line_items: FinancialStatementLineItem[]
  currency: string
  unit: string
}

// ── Entity Selection ────────────────────────────────────────────────────────

export type EntitySelection = string

// ── Combining Statement ─────────────────────────────────────────────────────

export interface CombiningLineItem {
  line_item: string
  meridian: number
  cascadia: number
  adjustments: number
  combined: number
}

export interface CombiningStatementData {
  period: string
  line_items: CombiningLineItem[]
}

// ── Overlap Report ──────────────────────────────────────────────────────────

export interface OverlapDomainSummary {
  overlap_count: number
  entity_a_total: number
  entity_b_total: number
  overlap_pct_a: number
  overlap_pct_b: number
}

export interface OverlapSummary {
  customer: OverlapDomainSummary
  vendor: OverlapDomainSummary
  employee: OverlapDomainSummary
}

export interface OverlapConceptDetail {
  concept: string
  entity_a_properties: Record<string, unknown>
  entity_b_properties: Record<string, unknown>
}

export interface OverlapDomainDetail {
  tenant_id: string
  entity_id: string
  domain: string
  overlap_count: number
  concepts: OverlapConceptDetail[]
}

export interface OverlapEntityOnlyResult {
  tenant_id: string
  domain: string
  entity_id: string
  count: number
  concepts: string[]
}

// ── Cross-Sell Pipeline ────────────────────────────────────────────────────

export interface CrossSellCandidate {
  customer_id: string
  customer_name: string
  entity_id: string
  recommended_service: string
  propensity_score: number
  estimated_acv: number
  industry_match: number
  size_match: number
  behavioral_score: number
  engagement_fit: number
  relationship_strength: number
  rationale: string
  comparable_customers: string[]
  buyer_persona: string
  customer_engagement_M: number
  years_as_client: number
  industry: string
  segment: string
}

export interface CrossSellSummary {
  m_to_c_candidates: number
  m_to_c_total_acv: number
  m_to_c_high_conf_count: number
  m_to_c_high_conf_acv: number
  c_to_m_candidates: number
  c_to_m_total_acv: number
  c_to_m_high_conf_count: number
  c_to_m_high_conf_acv: number
  total_candidates: number
  total_pipeline_acv: number
  total_high_conf_acv: number
}

export interface CrossSellData {
  m_to_c: CrossSellCandidate[]
  c_to_m: CrossSellCandidate[]
  summary: CrossSellSummary
}

// ── Upsell Pipeline ──────────────────────────────────────────────────────

export interface UpsellCandidate {
  customer_id: string
  customer_name: string
  source_entity: string
  target_entity: string
  gap_service: string
  gap_service_name: string
  typical_acv: number
  upsell_score: number
  relationship_strength: number
  service_adjacency: number
  revenue_potential: number
  contract_recency: number
  current_services: string[]
  current_engagement_revenue_M: number
  satisfaction_score: number
  contract_type: string
  engagement_start_year: number
  match_type: string
  rationale: string
}

export interface UpsellSummary {
  total_shared_customers: number
  total_opportunities: number
  total_expansion_acv: number
  avg_score: number
  m_to_c_count: number
  m_to_c_acv: number
  c_to_m_count: number
  c_to_m_acv: number
}

export interface UpsellData {
  m_to_c: UpsellCandidate[]
  c_to_m: UpsellCandidate[]
  summary: UpsellSummary
}

// ── Revenue by Customer ───────────────────────────────────────────────────

export interface RevenueByCustomerRow {
  name: string
  total: number
  [quarter: string]: string | number  // e.g. "2024-Q1": 1.75
}

export interface RevenueByCustomerData {
  entity_id: string
  quarters: string[]
  customers: RevenueByCustomerRow[]
  total_revenue: number
  customer_count: number
  provenance: {
    pipeline_run_id?: string | null
    mode?: string | null
    source?: string | null
    run_timestamp?: string | null
    entity_id?: string | null
  }
}

// ── EBITDA Bridge ──────────────────────────────────────────────────────────

export interface BridgeAdjustment {
  name: string
  category: string
  entity: string
  confidence: string
  amount: number
  amount_low: number
  amount_high: number
  lever: string | null
  support_reference: string
  rationale: string
}

export interface EBITDABridgeData {
  reported_ebitda: { meridian: number; cascadia: number; combined_reported: number }
  entity_adjustments: BridgeAdjustment[]
  entity_adjusted_ebitda: { meridian: number; cascadia: number; combined: number }
  combination_synergies: BridgeAdjustment[]
  pro_forma_ebitda: {
    year_1: { low: number; high: number; current: number }
    steady_state: { low: number; high: number; current: number }
  }
  ev_impact: {
    multiple: number
    year_1_ev: { low: number; high: number; current: number }
    steady_state_ev: { low: number; high: number; current: number }
  }
}

// ── What-If ────────────────────────────────────────────────────────────────

export interface LeverDefinition {
  name: string
  label: string
  min: number
  max: number
  default: number
  unit: string
  impact_per_point_M: number | null
  disabled?: boolean
}

export interface WhatIfResult {
  levers: Record<string, number>
  lever_definitions: LeverDefinition[]
  reported_ebitda: number
  entity_adjusted_ebitda: number
  adjustments: BridgeAdjustment[]
  synergies: BridgeAdjustment[]
  pro_forma_ebitda: { year_1: number; steady_state: number }
  ev_impact: { year_1: number; steady_state: number }
  ev_multiple?: number
  presets: Record<string, Record<string, number>>
  base_revenue?: number | null
  base_cogs?: number | null
  base_opex?: number | null
  degraded?: boolean
  warning?: string | null
}

// ── Pipeline ─────────────────────────────────────────────────────────────

export interface PipelineStage {
  label: string
  value: number
  percent: number
}

export interface PipelineReportData {
  entity_id: string
  entity_name: string
  period: string
  stages: PipelineStage[]
}

// ── Quality of Earnings ──────────────────────────────────────────────────

export interface QofEAdjustmentRow {
  name: string
  category: string
  entity: string
  confidence: string
  current_amount: number
  diligence_amount: number | null
  prior_amount: number | null
  amount_low: number
  amount_high: number
  lever: string | null
  support_reference: string
  rationale: string
  status: 'active' | 'resolved' | 'new' | 'changed'
  lifecycle_stage: string
  trend: 'improving' | 'stable' | 'worsening'
  lifecycle_history?: { stage: string; amount: number; amount_low: number; amount_high: number; confidence: number }[]
}

export interface QofESustainabilityScore {
  overall: number
  components: { name: string; score: number; weight: number; max_points: number }[]
  grade: string
}

export interface QofEData {
  period: string
  is_initial_diligence: boolean
  ebitda_bridge: QofEAdjustmentRow[]
  adjustment_lifecycle: {
    lifecycle_stages: Record<string, { count: number; items: string[] }>
    status_counts: Record<string, number>
    total_adjustments: number
  }
  revenue_quality: {
    customer_concentration: {
      hhi: number
      top_10_pct: number
      top_20_pct: number
      top_50_pct: number
      threshold_alerts: { customer: string; pct: number; threshold: string }[]
      total_customers: number
    }
    contract_quality: {
      msa_pct: number
      sow_pct: number
      t_and_m_pct: number
      avg_tenure_years: number
    }
    revenue_mix: {
      recurring_pct: number
      non_recurring_pct: number
      consulting_tm_M: number
      managed_services_M: number
      per_fte_M: number
      per_transaction_M: number
      fixed_fee_M: number
    }
    cohort_retention: { years_as_client: number; total_revenue_M: number }[]
    cross_sell_penetration: {
      total_candidates: number
      total_pipeline_acv_M: number
      converted_count: number
      converted_acv_M: number
      conversion_rate_pct: number
    }
    upsell_penetration?: {
      shared_customers: number
      total_gap_services: number
      total_expansion_acv_M: number
      avg_upsell_score: number
    }
  }
  sustainability_score: QofESustainabilityScore
  working_capital: {
    dso_trend: { period: string; value: number }[]
    dpo_trend: { period: string; value: number }[]
    bench_cost_trend: { period: string; value: number }[]
    working_capital_pct_trend: { period: string; value: number }[]
    margin_trend: { period: string; gross_margin_pct: number; ebitda_margin_pct: number }[]
  }
  new_items: {
    type: string
    description: string
    amount: number
    category: string
    classification_suggestion: string
    recommended_action: string
  }[]
  summary: {
    reported_ebitda: number
    entity_adjusted_ebitda: number
    pro_forma_year_1: number
    pro_forma_steady_state: number
    total_adjustments: number
    active_adjustments: number
    resolved_adjustments: number
    new_adjustments: number
    changed_adjustments: number
    sustainability_score: number
    sustainability_grade: string
  }
}

