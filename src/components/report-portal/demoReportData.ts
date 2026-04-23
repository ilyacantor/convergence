// DEMO HARDCODE — NOT REAL DATA.
// X-Sell / Upsell / QofE tabs render identical canned numbers
// regardless of entity pair selection. Engines, Farm templates,
// and backend data are bypassed entirely. Restore real wiring
// when Farm's Multi-Entity templates emit customer/service data
// and engines are validated against them.

import type { CrossSellData, UpsellData, QofEData } from "./types";

// ── Cross-Sell fixture ──────────────────────────────────────────────────────
// Representative M&A pipeline: one direction has the higher-value practice
// targets, the other has broader but smaller BPM opportunities.

export const DEMO_CROSS_SELL: CrossSellData = {
  a_to_b: [
    {
      customer_id: "c-jpmc",
      customer_name: "JPMorgan Chase",
      entity_id: "entity_a",
      recommended_service: "Risk Advisory",
      propensity_score: 92,
      estimated_acv: 6.4,
      industry_match: 24,
      size_match: 19,
      behavioral_score: 27,
      engagement_fit: 14,
      relationship_strength: 8,
      rationale: "Active strategy engagement since 2019; CRO-level access; regulatory cycle aligns with risk-advisory ramp.",
      comparable_customers: ["Goldman Sachs", "Bank of America"],
      buyer_persona: "CRO / Chief Risk Officer",
      customer_engagement_M: 4.8,
      years_as_client: 6,
      industry: "Financial Services",
      segment: "Enterprise",
    },
    {
      customer_id: "c-uhg",
      customer_name: "UnitedHealth Group",
      entity_id: "entity_a",
      recommended_service: "Digital / AI",
      propensity_score: 87,
      estimated_acv: 5.9,
      industry_match: 22,
      size_match: 20,
      behavioral_score: 25,
      engagement_fit: 13,
      relationship_strength: 7,
      rationale: "Prior analytics roadmap plus active AI budget increase; procurement cycle opens Q3.",
      comparable_customers: ["Pfizer", "Johnson & Johnson"],
      buyer_persona: "Chief Digital Officer",
      customer_engagement_M: 3.6,
      years_as_client: 4,
      industry: "Healthcare",
      segment: "Enterprise",
    },
    {
      customer_id: "c-amzn",
      customer_name: "Amazon",
      entity_id: "entity_a",
      recommended_service: "Operations Transformation",
      propensity_score: 81,
      estimated_acv: 7.2,
      industry_match: 21,
      size_match: 20,
      behavioral_score: 22,
      engagement_fit: 12,
      relationship_strength: 6,
      rationale: "Fulfillment network redesign in flight; prior consulting work on last-mile opens the door.",
      comparable_customers: ["Walmart", "Target"],
      buyer_persona: "COO / VP Operations",
      customer_engagement_M: 5.5,
      years_as_client: 3,
      industry: "Retail / Logistics",
      segment: "Enterprise",
    },
    {
      customer_id: "c-att",
      customer_name: "AT&T",
      entity_id: "entity_a",
      recommended_service: "Commercial Strategy",
      propensity_score: 74,
      estimated_acv: 4.1,
      industry_match: 20,
      size_match: 18,
      behavioral_score: 19,
      engagement_fit: 11,
      relationship_strength: 6,
      rationale: "Telco pricing transformation mandate; CFO-level sponsor identified.",
      comparable_customers: ["Verizon", "T-Mobile"],
      buyer_persona: "CFO / CRO",
      customer_engagement_M: 2.9,
      years_as_client: 5,
      industry: "Telecommunications",
      segment: "Enterprise",
    },
    {
      customer_id: "c-pfe",
      customer_name: "Pfizer",
      entity_id: "entity_a",
      recommended_service: "Technology Modernization",
      propensity_score: 68,
      estimated_acv: 3.8,
      industry_match: 19,
      size_match: 17,
      behavioral_score: 17,
      engagement_fit: 10,
      relationship_strength: 5,
      rationale: "Clinical-data platform replatform underway; legacy vendor exit in 18 months.",
      comparable_customers: ["Johnson & Johnson", "Merck"],
      buyer_persona: "CTO / Head of R&D IT",
      customer_engagement_M: 2.4,
      years_as_client: 2,
      industry: "Pharmaceuticals",
      segment: "Enterprise",
    },
    {
      customer_id: "c-wmt",
      customer_name: "Walmart",
      entity_id: "entity_a",
      recommended_service: "Strategy",
      propensity_score: 61,
      estimated_acv: 3.3,
      industry_match: 17,
      size_match: 18,
      behavioral_score: 14,
      engagement_fit: 9,
      relationship_strength: 5,
      rationale: "New CSO appointed six months ago; exploring channel strategy refresh.",
      comparable_customers: ["Target", "Costco"],
      buyer_persona: "Chief Strategy Officer",
      customer_engagement_M: 2.1,
      years_as_client: 4,
      industry: "Retail",
      segment: "Enterprise",
    },
  ],
  b_to_a: [
    {
      customer_id: "c-ibm",
      customer_name: "IBM",
      entity_id: "entity_b",
      recommended_service: "Finance & Accounting Operations",
      propensity_score: 84,
      estimated_acv: 5.6,
      industry_match: 22,
      size_match: 19,
      behavioral_score: 24,
      engagement_fit: 13,
      relationship_strength: 8,
      rationale: "Shared-services consolidation RFP in market; existing BPM relationship from last year.",
      comparable_customers: ["Accenture", "Deloitte"],
      buyer_persona: "CFO / VP Finance",
      customer_engagement_M: 3.9,
      years_as_client: 5,
      industry: "Technology",
      segment: "Enterprise",
    },
    {
      customer_id: "c-intc",
      customer_name: "Intel",
      entity_id: "entity_b",
      recommended_service: "HR Operations",
      propensity_score: 78,
      estimated_acv: 4.4,
      industry_match: 21,
      size_match: 18,
      behavioral_score: 22,
      engagement_fit: 12,
      relationship_strength: 7,
      rationale: "Global HR platform consolidation post-reorg; executive sponsorship confirmed.",
      comparable_customers: ["AMD", "Qualcomm"],
      buyer_persona: "CHRO / VP People",
      customer_engagement_M: 3.2,
      years_as_client: 3,
      industry: "Technology",
      segment: "Enterprise",
    },
    {
      customer_id: "c-citi",
      customer_name: "Citigroup",
      entity_id: "entity_b",
      recommended_service: "Customer Operations",
      propensity_score: 71,
      estimated_acv: 3.9,
      industry_match: 20,
      size_match: 19,
      behavioral_score: 19,
      engagement_fit: 10,
      relationship_strength: 6,
      rationale: "Card-ops consolidation across retail + wealth; offshore mandate accepted by board.",
      comparable_customers: ["Bank of America", "Wells Fargo"],
      buyer_persona: "COO / SVP Customer Experience",
      customer_engagement_M: 2.7,
      years_as_client: 4,
      industry: "Financial Services",
      segment: "Enterprise",
    },
    {
      customer_id: "c-ge",
      customer_name: "General Electric",
      entity_id: "entity_b",
      recommended_service: "Supply Chain",
      propensity_score: 65,
      estimated_acv: 3.5,
      industry_match: 19,
      size_match: 17,
      behavioral_score: 17,
      engagement_fit: 10,
      relationship_strength: 5,
      rationale: "Post-spinoff supply-chain rewire; near-shore manufacturing shift announced.",
      comparable_customers: ["Honeywell", "3M"],
      buyer_persona: "COO / VP Supply Chain",
      customer_engagement_M: 2.2,
      years_as_client: 3,
      industry: "Industrial",
      segment: "Enterprise",
    },
    {
      customer_id: "c-vz",
      customer_name: "Verizon",
      entity_id: "entity_b",
      recommended_service: "Finance & Accounting",
      propensity_score: 58,
      estimated_acv: 2.8,
      industry_match: 17,
      size_match: 17,
      behavioral_score: 14,
      engagement_fit: 9,
      relationship_strength: 5,
      rationale: "Shared-services refresh; current provider contract ends in 14 months.",
      comparable_customers: ["AT&T", "T-Mobile"],
      buyer_persona: "CFO",
      customer_engagement_M: 1.8,
      years_as_client: 2,
      industry: "Telecommunications",
      segment: "Enterprise",
    },
  ],
  summary: {
    a_to_b_candidates: 6,
    a_to_b_total_acv: 30.7,
    a_to_b_high_conf_count: 3,
    a_to_b_high_conf_acv: 19.5,
    b_to_a_candidates: 5,
    b_to_a_total_acv: 20.2,
    b_to_a_high_conf_count: 2,
    b_to_a_high_conf_acv: 10.0,
    total_candidates: 11,
    total_pipeline_acv: 50.9,
    total_high_conf_acv: 29.5,
  },
};

// ── Upsell fixture ──────────────────────────────────────────────────────────
// Shared customers where one entity has a service the other doesn't.

export const DEMO_UPSELL: UpsellData = {
  a_to_b: [
    {
      customer_id: "c-jpmc",
      customer_name: "JPMorgan Chase",
      source_entity: "entity_a",
      target_entity: "entity_b",
      gap_service: "strategy",
      gap_service_name: "Strategy Advisory",
      typical_acv: 4.6,
      upsell_score: 88,
      relationship_strength: 27,
      service_adjacency: 22,
      revenue_potential: 23,
      contract_recency: 16,
      current_services: ["risk", "technology", "finance_accounting"],
      current_engagement_revenue_M: 8.5,
      satisfaction_score: 91,
      contract_type: "MSA",
      engagement_start_year: 2019,
      match_type: "exact",
      rationale: "Strong multi-practice footprint; CEO access through existing sponsor opens strategy.",
    },
    {
      customer_id: "c-amzn",
      customer_name: "Amazon",
      source_entity: "entity_a",
      target_entity: "entity_b",
      gap_service: "digital_ai",
      gap_service_name: "Digital & AI",
      typical_acv: 5.3,
      upsell_score: 82,
      relationship_strength: 24,
      service_adjacency: 21,
      revenue_potential: 22,
      contract_recency: 15,
      current_services: ["operations", "customer_operations"],
      current_engagement_revenue_M: 6.8,
      satisfaction_score: 87,
      contract_type: "MSA",
      engagement_start_year: 2021,
      match_type: "exact",
      rationale: "AI roadmap investment announced; operations team already embedded with fulfillment data.",
    },
    {
      customer_id: "c-bac",
      customer_name: "Bank of America",
      source_entity: "entity_a",
      target_entity: "entity_b",
      gap_service: "commercial",
      gap_service_name: "Commercial Strategy",
      typical_acv: 3.9,
      upsell_score: 76,
      relationship_strength: 22,
      service_adjacency: 19,
      revenue_potential: 20,
      contract_recency: 15,
      current_services: ["finance_accounting", "risk"],
      current_engagement_revenue_M: 5.2,
      satisfaction_score: 84,
      contract_type: "SOW",
      engagement_start_year: 2020,
      match_type: "exact",
      rationale: "Wealth-segment repositioning on Q2 board agenda; prior risk work earns the seat.",
    },
    {
      customer_id: "c-gs",
      customer_name: "Goldman Sachs",
      source_entity: "entity_a",
      target_entity: "entity_b",
      gap_service: "technology",
      gap_service_name: "Technology Modernization",
      typical_acv: 4.2,
      upsell_score: 69,
      relationship_strength: 20,
      service_adjacency: 17,
      revenue_potential: 18,
      contract_recency: 14,
      current_services: ["risk"],
      current_engagement_revenue_M: 3.1,
      satisfaction_score: 79,
      contract_type: "SOW",
      engagement_start_year: 2022,
      match_type: "exact",
      rationale: "Legacy trading platform migration scoped; technology practice has sector case studies ready.",
    },
    {
      customer_id: "c-att",
      customer_name: "AT&T",
      source_entity: "entity_a",
      target_entity: "entity_b",
      gap_service: "operations",
      gap_service_name: "Operations Transformation",
      typical_acv: 3.4,
      upsell_score: 62,
      relationship_strength: 18,
      service_adjacency: 16,
      revenue_potential: 16,
      contract_recency: 12,
      current_services: ["commercial"],
      current_engagement_revenue_M: 2.5,
      satisfaction_score: 76,
      contract_type: "T&M",
      engagement_start_year: 2023,
      match_type: "exact",
      rationale: "Network ops refresh coming; existing commercial sponsor willing to introduce COO team.",
    },
  ],
  b_to_a: [
    {
      customer_id: "c-jpmc",
      customer_name: "JPMorgan Chase",
      source_entity: "entity_b",
      target_entity: "entity_a",
      gap_service: "hr_operations",
      gap_service_name: "HR Operations",
      typical_acv: 3.2,
      upsell_score: 79,
      relationship_strength: 24,
      service_adjacency: 20,
      revenue_potential: 19,
      contract_recency: 16,
      current_services: ["finance_accounting"],
      current_engagement_revenue_M: 2.8,
      satisfaction_score: 88,
      contract_type: "MSA",
      engagement_start_year: 2019,
      match_type: "exact",
      rationale: "Benefits admin RFP in market; existing F&A relationship scores high on satisfaction.",
    },
    {
      customer_id: "c-amzn",
      customer_name: "Amazon",
      source_entity: "entity_b",
      target_entity: "entity_a",
      gap_service: "supply_chain",
      gap_service_name: "Supply Chain Ops",
      typical_acv: 4.1,
      upsell_score: 74,
      relationship_strength: 21,
      service_adjacency: 19,
      revenue_potential: 20,
      contract_recency: 14,
      current_services: ["customer_operations"],
      current_engagement_revenue_M: 3.6,
      satisfaction_score: 83,
      contract_type: "MSA",
      engagement_start_year: 2021,
      match_type: "exact",
      rationale: "Last-mile ops scale-out planned; customer-ops work creates direct warehouse-ops bridge.",
    },
    {
      customer_id: "c-intc",
      customer_name: "Intel",
      source_entity: "entity_b",
      target_entity: "entity_a",
      gap_service: "finance_accounting",
      gap_service_name: "Finance & Accounting",
      typical_acv: 2.9,
      upsell_score: 67,
      relationship_strength: 20,
      service_adjacency: 17,
      revenue_potential: 16,
      contract_recency: 14,
      current_services: ["hr_operations"],
      current_engagement_revenue_M: 2.2,
      satisfaction_score: 81,
      contract_type: "SOW",
      engagement_start_year: 2022,
      match_type: "exact",
      rationale: "Global finance consolidation post-reorg; HR ops team referenceable to finance org.",
    },
    {
      customer_id: "c-vz",
      customer_name: "Verizon",
      source_entity: "entity_b",
      target_entity: "entity_a",
      gap_service: "customer_operations",
      gap_service_name: "Customer Operations",
      typical_acv: 3.1,
      upsell_score: 60,
      relationship_strength: 17,
      service_adjacency: 15,
      revenue_potential: 16,
      contract_recency: 12,
      current_services: ["finance_accounting"],
      current_engagement_revenue_M: 1.9,
      satisfaction_score: 77,
      contract_type: "T&M",
      engagement_start_year: 2023,
      match_type: "exact",
      rationale: "Contact-center RFP expected Q3; prior F&A track record helps scope.",
    },
  ],
  summary: {
    total_shared_customers: 8,
    total_opportunities: 9,
    total_expansion_acv: 34.7,
    avg_score: 73,
    a_to_b_count: 5,
    a_to_b_acv: 21.4,
    b_to_a_count: 4,
    b_to_a_acv: 13.3,
  },
};

// ── QofE fixture ────────────────────────────────────────────────────────────
// Full shape: EBITDA bridge, revenue quality, sustainability, working capital,
// margin trend, and a couple of new items. Populated so every sub-tab renders.

const _adjRow = (o: Partial<QofEData["ebitda_bridge"][number]> & Pick<QofEData["ebitda_bridge"][number],
  "name" | "category" | "entity" | "current_amount">) => ({
  confidence: "high" as const,
  diligence_amount: o.current_amount,
  prior_amount: null,
  amount_low: o.current_amount * 0.85,
  amount_high: o.current_amount * 1.15,
  lever: null,
  support_reference: "Management schedule, auditor workpaper",
  rationale: "Quality-of-earnings adjustment applied per diligence memo.",
  status: "active" as const,
  lifecycle_stage: "confirmed",
  trend: "stable" as const,
  ...o,
});

export const DEMO_QOFE: QofEData = {
  period: "FY 2026",
  is_initial_diligence: false,
  ebitda_bridge: [
    _adjRow({ name: "Non-recurring legal settlement", category: "non_recurring", entity: "entity_a", current_amount: 4.8, trend: "improving", rationale: "One-time IP litigation settled Q1; no follow-on activity." }),
    _adjRow({ name: "Owner compensation normalization", category: "owner_comp", entity: "entity_a", current_amount: 2.9, rationale: "Partner distribution normalized to market comp schedule." }),
    _adjRow({ name: "Run-rate synergies — shared services", category: "synergy", entity: "combined", current_amount: 6.2, confidence: "medium", rationale: "Shared F&A + HR back-office consolidation, 18-month glide path.", lever: "org_design" }),
    _adjRow({ name: "Procurement rebates underbooked", category: "accounting", entity: "entity_b", current_amount: 1.7, diligence_amount: 1.7, prior_amount: 1.2, trend: "improving", rationale: "Vendor rebate recognition aligned to receipt vs accrual." }),
    _adjRow({ name: "Recruiting capitalized (to expense)", category: "accounting", entity: "entity_a", current_amount: -3.4, trend: "stable", rationale: "Prior capitalization reversed; fully expensed per post-close policy." }),
    _adjRow({ name: "Cloud reservation pricing optimization", category: "cost_action", entity: "entity_b", current_amount: 2.1, confidence: "medium", rationale: "Reserved-instance conversion on AWS/Azure; 3-yr term.", lever: "cloud_optimization" }),
    _adjRow({ name: "Bench cost reduction", category: "cost_action", entity: "entity_a", current_amount: 3.6, confidence: "medium", trend: "improving", rationale: "Utilization improvement from 72% to 78% over two quarters.", lever: "utilization" }),
  ],
  adjustment_lifecycle: {
    lifecycle_stages: {
      confirmed: { count: 5, items: ["Non-recurring legal settlement", "Owner compensation normalization", "Procurement rebates underbooked", "Recruiting capitalized (to expense)", "Bench cost reduction"] },
      validation: { count: 2, items: ["Run-rate synergies — shared services", "Cloud reservation pricing optimization"] },
    },
    status_counts: { active: 7, resolved: 0, new: 0, changed: 0 },
    total_adjustments: 7,
  },
  revenue_quality: {
    customer_concentration: {
      hhi: 1180,
      top_10_pct: 42.6,
      top_20_pct: 58.3,
      top_50_pct: 78.1,
      threshold_alerts: [{ customer: "JPMorgan Chase", pct: 9.4, threshold: ">8%" }],
      total_customers: 1320,
    },
    contract_quality: {
      msa_pct: 62,
      sow_pct: 24,
      t_and_m_pct: 14,
      avg_tenure_years: 4.3,
    },
    revenue_mix: {
      recurring_pct: 68,
      non_recurring_pct: 32,
      consulting_tm_M: 48.4,
      managed_services_M: 61.2,
      per_fte_M: 18.5,
      per_transaction_M: 9.1,
      fixed_fee_M: 15.3,
    },
    cohort_retention: [
      { years_as_client: 1, total_revenue_M: 22.4 },
      { years_as_client: 2, total_revenue_M: 31.8 },
      { years_as_client: 3, total_revenue_M: 28.5 },
      { years_as_client: 4, total_revenue_M: 24.9 },
      { years_as_client: 5, total_revenue_M: 20.1 },
    ],
    cross_sell_penetration: {
      total_candidates: 11,
      total_pipeline_acv_M: 50.9,
      converted_count: 3,
      converted_acv_M: 14.7,
      conversion_rate_pct: 27,
    },
    upsell_penetration: {
      shared_customers: 8,
      total_gap_services: 9,
      total_expansion_acv_M: 34.7,
      avg_upsell_score: 73,
    },
  },
  sustainability_score: {
    overall: 72,
    components: [
      { name: "Revenue durability", score: 20, weight: 25, max_points: 25 },
      { name: "Margin consistency", score: 17, weight: 25, max_points: 25 },
      { name: "Customer concentration", score: 14, weight: 20, max_points: 20 },
      { name: "Contract quality", score: 13, weight: 20, max_points: 20 },
      { name: "Adjustment volatility", score: 8, weight: 10, max_points: 10 },
    ],
    grade: "B+",
  },
  working_capital: {
    dso_trend: [
      { period: "2024-Q4", value: 71.2 },
      { period: "2025-Q1", value: 68.9 },
      { period: "2025-Q2", value: 66.5 },
      { period: "2025-Q3", value: 64.8 },
      { period: "2025-Q4", value: 63.1 },
    ],
    dpo_trend: [
      { period: "2024-Q4", value: 38.2 },
      { period: "2025-Q1", value: 40.4 },
      { period: "2025-Q2", value: 42.1 },
      { period: "2025-Q3", value: 43.7 },
      { period: "2025-Q4", value: 44.5 },
    ],
    bench_cost_trend: [
      { period: "2024-Q4", value: 8.6 },
      { period: "2025-Q1", value: 7.8 },
      { period: "2025-Q2", value: 7.1 },
      { period: "2025-Q3", value: 6.4 },
      { period: "2025-Q4", value: 5.9 },
    ],
    working_capital_pct_trend: [
      { period: "2024-Q4", value: 18.4 },
      { period: "2025-Q1", value: 17.8 },
      { period: "2025-Q2", value: 17.1 },
      { period: "2025-Q3", value: 16.5 },
      { period: "2025-Q4", value: 16.0 },
    ],
    margin_trend: [
      { period: "2024-Q4", gross_margin_pct: 38.2, ebitda_margin_pct: 18.4 },
      { period: "2025-Q1", gross_margin_pct: 38.9, ebitda_margin_pct: 19.1 },
      { period: "2025-Q2", gross_margin_pct: 39.4, ebitda_margin_pct: 19.8 },
      { period: "2025-Q3", gross_margin_pct: 39.8, ebitda_margin_pct: 20.3 },
      { period: "2025-Q4", gross_margin_pct: 40.2, ebitda_margin_pct: 20.9 },
    ],
  },
  new_items: [
    {
      type: "addback",
      description: "Cyber incident response retainer (non-recurring)",
      amount: 1.2,
      category: "non_recurring",
      classification_suggestion: "addback",
      recommended_action: "add_to_bridge",
    },
    {
      type: "exclusion",
      description: "Reclass of R&D credits to below-the-line",
      amount: -0.6,
      category: "tax",
      classification_suggestion: "exclude",
      recommended_action: "review",
    },
  ],
  summary: {
    reported_ebitda: 61.3,
    entity_adjusted_ebitda: 78.2,
    pro_forma_year_1: 85.6,
    pro_forma_steady_state: 94.8,
    total_adjustments: 7,
    active_adjustments: 7,
    resolved_adjustments: 0,
    new_adjustments: 0,
    changed_adjustments: 0,
    sustainability_score: 72,
    sustainability_grade: "B+",
  },
};

// ── DEMO JITTER — deterministic per engagement_id, ±10%, not real data. ─────
//
// Single helper. Hash (engagement_id + field_path) → factor in [0.9, 1.1].
// Same engagement always renders the same numbers; different engagements
// render different numbers; back-to-back demos don't look frozen.

type RoundMode = 'int' | 'one' | 'two';

function _hash32(s: string): number {
  // FNV-1a, 32-bit
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function demoJitter(value: number, engagementId: string, field: string, mode: RoundMode = 'one'): number {
  if (!engagementId || !Number.isFinite(value) || value === 0) return value;
  const factor = 0.9 + (_hash32(`${engagementId}::${field}`) / 4294967295) * 0.2;
  const j = value * factor;
  if (mode === 'int') return Math.round(j);
  if (mode === 'one') return Math.round(j * 10) / 10;
  return Math.round(j * 100) / 100;
}

// ── Cross-Sell getter ──────────────────────────────────────────────────────

export function getDemoCrossSell(engagementId: string): CrossSellData {
  const jitterRow = (c: CrossSellData['a_to_b'][number], i: number, dir: 'a2b' | 'b2a') => {
    const p = `${dir}.${i}`;
    return {
      ...c,
      propensity_score: demoJitter(c.propensity_score, engagementId, `${p}.score`, 'int'),
      estimated_acv: demoJitter(c.estimated_acv, engagementId, `${p}.acv`, 'one'),
      industry_match: demoJitter(c.industry_match, engagementId, `${p}.im`, 'int'),
      size_match: demoJitter(c.size_match, engagementId, `${p}.sm`, 'int'),
      behavioral_score: demoJitter(c.behavioral_score, engagementId, `${p}.bs`, 'int'),
      engagement_fit: demoJitter(c.engagement_fit, engagementId, `${p}.ef`, 'int'),
      relationship_strength: demoJitter(c.relationship_strength, engagementId, `${p}.rs`, 'int'),
      customer_engagement_M: demoJitter(c.customer_engagement_M, engagementId, `${p}.ce`, 'one'),
      years_as_client: demoJitter(c.years_as_client, engagementId, `${p}.yc`, 'int'),
    };
  };

  const a_to_b = DEMO_CROSS_SELL.a_to_b.map((c, i) => jitterRow(c, i, 'a2b'));
  const b_to_a = DEMO_CROSS_SELL.b_to_a.map((c, i) => jitterRow(c, i, 'b2a'));

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const sumAcv = (arr: typeof a_to_b) => r1(arr.reduce((s, c) => s + c.estimated_acv, 0));
  const highAcv = (arr: typeof a_to_b) => r1(arr.filter(c => c.propensity_score >= 80).reduce((s, c) => s + c.estimated_acv, 0));
  const highCount = (arr: typeof a_to_b) => arr.filter(c => c.propensity_score >= 80).length;

  const a2b_total = sumAcv(a_to_b);
  const b2a_total = sumAcv(b_to_a);
  const a2b_high = highAcv(a_to_b);
  const b2a_high = highAcv(b_to_a);

  return {
    a_to_b,
    b_to_a,
    summary: {
      a_to_b_candidates: a_to_b.length,
      a_to_b_total_acv: a2b_total,
      a_to_b_high_conf_count: highCount(a_to_b),
      a_to_b_high_conf_acv: a2b_high,
      b_to_a_candidates: b_to_a.length,
      b_to_a_total_acv: b2a_total,
      b_to_a_high_conf_count: highCount(b_to_a),
      b_to_a_high_conf_acv: b2a_high,
      total_candidates: a_to_b.length + b_to_a.length,
      total_pipeline_acv: r1(a2b_total + b2a_total),
      total_high_conf_acv: r1(a2b_high + b2a_high),
    },
  };
}

// ── Upsell getter ──────────────────────────────────────────────────────────

export function getDemoUpsell(engagementId: string): UpsellData {
  const jitterRow = (c: UpsellData['a_to_b'][number], i: number, dir: 'a2b' | 'b2a') => {
    const p = `${dir}.${i}`;
    return {
      ...c,
      typical_acv: demoJitter(c.typical_acv, engagementId, `${p}.acv`, 'one'),
      upsell_score: demoJitter(c.upsell_score, engagementId, `${p}.score`, 'int'),
      relationship_strength: demoJitter(c.relationship_strength, engagementId, `${p}.rs`, 'int'),
      service_adjacency: demoJitter(c.service_adjacency, engagementId, `${p}.sa`, 'int'),
      revenue_potential: demoJitter(c.revenue_potential, engagementId, `${p}.rp`, 'int'),
      contract_recency: demoJitter(c.contract_recency, engagementId, `${p}.cr`, 'int'),
      current_engagement_revenue_M: demoJitter(c.current_engagement_revenue_M, engagementId, `${p}.cer`, 'one'),
      satisfaction_score: demoJitter(c.satisfaction_score, engagementId, `${p}.ss`, 'int'),
    };
  };

  const a_to_b = DEMO_UPSELL.a_to_b.map((c, i) => jitterRow(c, i, 'a2b'));
  const b_to_a = DEMO_UPSELL.b_to_a.map((c, i) => jitterRow(c, i, 'b2a'));

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const sumAcv = (arr: typeof a_to_b) => r1(arr.reduce((s, c) => s + c.typical_acv, 0));
  const avgScore = [...a_to_b, ...b_to_a].reduce((s, c) => s + c.upsell_score, 0) / (a_to_b.length + b_to_a.length);

  const a2b_acv = sumAcv(a_to_b);
  const b2a_acv = sumAcv(b_to_a);

  return {
    a_to_b,
    b_to_a,
    summary: {
      total_shared_customers: demoJitter(DEMO_UPSELL.summary.total_shared_customers, engagementId, 'sum.shared', 'int'),
      total_opportunities: a_to_b.length + b_to_a.length,
      total_expansion_acv: r1(a2b_acv + b2a_acv),
      avg_score: Math.round(avgScore),
      a_to_b_count: a_to_b.length,
      a_to_b_acv: a2b_acv,
      b_to_a_count: b_to_a.length,
      b_to_a_acv: b2a_acv,
    },
  };
}

// ── QofE getter ────────────────────────────────────────────────────────────

export function getDemoQofE(engagementId: string): QofEData {
  const j1 = (v: number, f: string) => demoJitter(v, engagementId, f, 'one');
  const jI = (v: number, f: string) => demoJitter(v, engagementId, f, 'int');

  const ebitda_bridge = DEMO_QOFE.ebitda_bridge.map((r, i) => {
    const p = `bridge.${i}`;
    const cur = j1(r.current_amount, `${p}.current`);
    return {
      ...r,
      current_amount: cur,
      diligence_amount: r.diligence_amount !== null ? j1(r.diligence_amount, `${p}.dil`) : null,
      prior_amount: r.prior_amount !== null ? j1(r.prior_amount, `${p}.prior`) : null,
      amount_low: j1(Math.abs(cur) * 0.85, `${p}.low`) * Math.sign(cur || 1),
      amount_high: j1(Math.abs(cur) * 1.15, `${p}.high`) * Math.sign(cur || 1),
    };
  });

  const rq = DEMO_QOFE.revenue_quality;
  // Jitter recurring_pct; non_recurring = 100 - recurring. Same for contract mix.
  const recurring_pct = jI(rq.revenue_mix.recurring_pct, 'mix.recurring');
  const msa_pct = jI(rq.contract_quality.msa_pct, 'ctx.msa');
  const sow_pct = jI(rq.contract_quality.sow_pct, 'ctx.sow');

  const revenue_quality: QofEData['revenue_quality'] = {
    customer_concentration: {
      hhi: jI(rq.customer_concentration.hhi, 'cc.hhi'),
      top_10_pct: j1(rq.customer_concentration.top_10_pct, 'cc.top10'),
      top_20_pct: j1(rq.customer_concentration.top_20_pct, 'cc.top20'),
      top_50_pct: j1(rq.customer_concentration.top_50_pct, 'cc.top50'),
      threshold_alerts: rq.customer_concentration.threshold_alerts.map((a, i) => ({
        ...a,
        pct: j1(a.pct, `cc.alert.${i}`),
      })),
      total_customers: jI(rq.customer_concentration.total_customers, 'cc.total'),
    },
    contract_quality: {
      msa_pct,
      sow_pct,
      t_and_m_pct: Math.max(0, 100 - msa_pct - sow_pct),
      avg_tenure_years: j1(rq.contract_quality.avg_tenure_years, 'ctx.tenure'),
    },
    revenue_mix: {
      recurring_pct,
      non_recurring_pct: 100 - recurring_pct,
      consulting_tm_M: j1(rq.revenue_mix.consulting_tm_M, 'mix.tm'),
      managed_services_M: j1(rq.revenue_mix.managed_services_M, 'mix.managed'),
      per_fte_M: j1(rq.revenue_mix.per_fte_M, 'mix.fte'),
      per_transaction_M: j1(rq.revenue_mix.per_transaction_M, 'mix.txn'),
      fixed_fee_M: j1(rq.revenue_mix.fixed_fee_M, 'mix.fixed'),
    },
    cohort_retention: rq.cohort_retention.map((c, i) => ({
      ...c,
      total_revenue_M: j1(c.total_revenue_M, `cohort.${i}`),
    })),
    cross_sell_penetration: {
      total_candidates: jI(rq.cross_sell_penetration.total_candidates, 'xsp.cand'),
      total_pipeline_acv_M: j1(rq.cross_sell_penetration.total_pipeline_acv_M, 'xsp.acv'),
      converted_count: jI(rq.cross_sell_penetration.converted_count, 'xsp.conv'),
      converted_acv_M: j1(rq.cross_sell_penetration.converted_acv_M, 'xsp.convAcv'),
      conversion_rate_pct: jI(rq.cross_sell_penetration.conversion_rate_pct, 'xsp.rate'),
    },
    upsell_penetration: rq.upsell_penetration && {
      shared_customers: jI(rq.upsell_penetration.shared_customers, 'usp.shared'),
      total_gap_services: jI(rq.upsell_penetration.total_gap_services, 'usp.gaps'),
      total_expansion_acv_M: j1(rq.upsell_penetration.total_expansion_acv_M, 'usp.acv'),
      avg_upsell_score: jI(rq.upsell_penetration.avg_upsell_score, 'usp.score'),
    },
  };

  const sustainability_overall = jI(DEMO_QOFE.sustainability_score.overall, 'sus.overall');
  const sustainability_score: QofEData['sustainability_score'] = {
    ...DEMO_QOFE.sustainability_score,
    overall: sustainability_overall,
    components: DEMO_QOFE.sustainability_score.components.map((c, i) => ({
      ...c,
      score: jI(c.score, `sus.c.${i}`),
    })),
  };

  const working_capital: QofEData['working_capital'] = {
    dso_trend: DEMO_QOFE.working_capital.dso_trend.map((d, i) => ({ ...d, value: j1(d.value, `wc.dso.${i}`) })),
    dpo_trend: DEMO_QOFE.working_capital.dpo_trend.map((d, i) => ({ ...d, value: j1(d.value, `wc.dpo.${i}`) })),
    bench_cost_trend: DEMO_QOFE.working_capital.bench_cost_trend.map((d, i) => ({ ...d, value: j1(d.value, `wc.bench.${i}`) })),
    working_capital_pct_trend: DEMO_QOFE.working_capital.working_capital_pct_trend.map((d, i) => ({ ...d, value: j1(d.value, `wc.pct.${i}`) })),
    margin_trend: DEMO_QOFE.working_capital.margin_trend.map((m, i) => ({
      period: m.period,
      gross_margin_pct: j1(m.gross_margin_pct, `wc.gm.${i}`),
      ebitda_margin_pct: j1(m.ebitda_margin_pct, `wc.em.${i}`),
    })),
  };

  const new_items = DEMO_QOFE.new_items.map((n, i) => ({ ...n, amount: j1(n.amount, `ni.${i}`) }));

  const summary: QofEData['summary'] = {
    reported_ebitda: j1(DEMO_QOFE.summary.reported_ebitda, 'sum.reported'),
    entity_adjusted_ebitda: j1(DEMO_QOFE.summary.entity_adjusted_ebitda, 'sum.adjusted'),
    pro_forma_year_1: j1(DEMO_QOFE.summary.pro_forma_year_1, 'sum.pf1'),
    pro_forma_steady_state: j1(DEMO_QOFE.summary.pro_forma_steady_state, 'sum.pfss'),
    total_adjustments: ebitda_bridge.length,
    active_adjustments: ebitda_bridge.length,
    resolved_adjustments: 0,
    new_adjustments: 0,
    changed_adjustments: 0,
    sustainability_score: sustainability_overall,
    sustainability_grade: DEMO_QOFE.summary.sustainability_grade,
  };

  return {
    ...DEMO_QOFE,
    ebitda_bridge,
    revenue_quality,
    sustainability_score,
    working_capital,
    new_items,
    summary,
  };
}
