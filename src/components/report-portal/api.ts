/**
 * API adapter functions for the Report Portal.
 *
 * Fetches data from Convergence backend endpoints and transforms responses
 * into the shapes expected by the portal components.
 *
 * Migrated from NLQ — all endpoints now point to /api/convergence/reports/v2/*.
 */

import type {
  ReportData,
  ReportLine,
  ReportVariant,
  FinancialStatementData,
  FinancialStatementLineItem,
  EntitySelection,
  CombiningStatementData,
  OverlapSummary,
  CrossSellData,
  UpsellData,
  RevenueByCustomerData,
  EBITDABridgeData,
  BridgeAdjustment,
  WhatIfResult,
  QofEData,
  PipelineReportData,
} from './types'

const CONVERGENCE_REPORTS_BASE = '/api/convergence/reports/v2'
const CONVERGENCE_ENGAGEMENT_URL = '/api/convergence/engagement/active'

/**
 * Sanitize error messages before displaying to operators.
 *
 * Per I2: tenant_id (UUID) is machine-only, never displayed.
 * Per I1: run_id is banned from user-facing surfaces.
 * Strips raw UUIDs, tenant_id=..., and run_id=... from error text.
 */
function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/tenant_id='[0-9a-f-]+'/gi, '')
    .replace(/run_id='[^']*'/gi, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted]')
    .replace(/\s*[—–-]\s*,\s*/g, ' — ')
    .replace(/,\s*}/g, '}')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── Engagement Context (tenant_id resolution) ───────────────────────────────

export interface EngagementContext {
  tenant_id: string
  engagement_id: string
  engagement_short_name: string
  deal_name: string
  entity_pair: [string, string]
  entity_a: { id: string; display_name: string; role: string }
  entity_b: { id: string; display_name: string; role: string }
}

let _engagementCache: EngagementContext | null = null

export async function getEngagementContext(): Promise<EngagementContext> {
  if (_engagementCache) return _engagementCache
  const res = await fetch(CONVERGENCE_ENGAGEMENT_URL)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(
      `Engagement context fetch failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`
    )
  }
  _engagementCache = await res.json()
  return _engagementCache!
}

async function getTenantId(): Promise<string> {
  const ctx = await getEngagementContext()
  return ctx.tenant_id
}

/** Append tenant_id to a URLSearchParams instance. */
async function withTenant(params?: URLSearchParams): Promise<URLSearchParams> {
  const p = params ?? new URLSearchParams()
  p.set('tenant_id', await getTenantId())
  return p
}

// ── Report Dimensions ────────────────────────────────────────────────────────

export interface PeriodDimension {
  label: string
  year: number
  quarter: number
  period_type: 'actual' | 'forecast'
  has_data: Record<string, boolean>
}

export interface ReportDimensions {
  periods: PeriodDimension[]
  segments: string[]
}

export async function fetchReportDimensions(): Promise<ReportDimensions> {
  const params = await withTenant()
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/dimensions?${params}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(
      `Report dimensions fetch failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`
    )
  }
  return res.json()
}

// ── Report (P&L, BS, SOCF) ──────────────────────────────────────────────────

function transformFSLineItem(
  item: FinancialStatementLineItem,
  periods: string[],
  periodIndex: number,
  index: number,
  totalItems: number,
): ReportLine {
  const period = periods[periodIndex]
  const amount = period ? (item.values[period] ?? null) : null

  return {
    id: item.key || `line-${index}`,
    name: item.label,
    amount,
    level: item.indent,
    isTotal: item.is_subtotal && item.label.toLowerCase().includes('total'),
    isHeader: amount === null && !item.is_subtotal && item.indent === 0,
    isSub: item.is_subtotal && !item.label.toLowerCase().includes('total'),
    bold: item.is_subtotal,
    isFinal: index === totalItems - 1 && item.is_subtotal,
    isPercent: item.format === 'percent',
    drillable: item.format !== 'percent' && (amount !== null || item.is_subtotal),
    highlight: item.key === 'bench_cost' || item.key === 'bench_cost_total',
  }
}

function transformToReportData(
  fsData: FinancialStatementData,
  segment: string | null,
  periodIndex = 0,
): ReportData {
  const lines = fsData.line_items.map((item, i) =>
    transformFSLineItem(item, fsData.periods, periodIndex, i, fsData.line_items.length)
  )

  const periodLabel = fsData.periods[periodIndex] || ''
  const hasForecast = periodLabel.toLowerCase().includes('forecast') ||
    periodLabel.toLowerCase().includes('cf') ||
    periodLabel.toLowerCase().includes('(act+cf)')

  return {
    lines,
    metadata: {
      entity: fsData.entity,
      quarter: periodLabel,
      segment,
      periodType: hasForecast ? 'forecast' : 'actual',
      unit: fsData.unit,
    },
  }
}

/** Map statement type to Convergence endpoint path segment. */
const STATEMENT_ENDPOINTS: Record<string, string> = {
  income_statement: 'income-statement',
  balance_sheet: 'balance-sheet',
  cash_flow: 'cash-flow',
}

// ── Transform backend financial dicts → FinancialStatementData ──────────────

function makeLineItem(
  key: string,
  label: string,
  amount: number | null,
  period: string,
  indent = 0,
  isSubtotal = false,
): FinancialStatementLineItem {
  return {
    key,
    label,
    indent,
    format: 'currency',
    is_subtotal: isSubtotal,
    values: { [period]: amount },
  }
}

function prettifyKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bAr\b/, 'A/R')
    .replace(/\bAp\b/, 'A/P')
    .replace(/\bCapex\b/, 'CapEx')
}

function sectionLines(
  sectionData: Record<string, unknown>,
  prefix: string,
  sectionLabel: string,
  period: string,
): FinancialStatementLineItem[] {
  const lines: FinancialStatementLineItem[] = []
  lines.push(makeLineItem(`${prefix}_header`, sectionLabel, null, period, 0, false))

  const total = typeof sectionData.total === 'number' ? sectionData.total : null
  for (const [k, v] of Object.entries(sectionData)) {
    if (k === 'total') continue
    // Skip dimensional breakdowns (by_practice.*, by_region.*, new_logo.by_region.*)
    if (k.includes('.')) continue
    if (typeof v === 'number') {
      lines.push(makeLineItem(`${prefix}.${k}`, prettifyKey(k), v, period, 1))
    }
  }
  lines.push(makeLineItem(`${prefix}.total`, `Total ${sectionLabel}`, total, period, 0, true))
  return lines
}

function transformIncomeStatement(
  data: Record<string, unknown>,
  period: string,
): FinancialStatementData {
  const entity = (data.entity_id as string) || 'unknown'
  const lines: FinancialStatementLineItem[] = []

  if (data.revenue && typeof data.revenue === 'object')
    lines.push(...sectionLines(data.revenue as Record<string, unknown>, 'revenue', 'Revenue', period))
  if (data.cogs && typeof data.cogs === 'object')
    lines.push(...sectionLines(data.cogs as Record<string, unknown>, 'cogs', 'COGS', period))

  // Gross Profit (derived)
  const revTotal = (data.revenue as Record<string, unknown>)?.total
  const cogsTotal = (data.cogs as Record<string, unknown>)?.total
  if (typeof revTotal === 'number' && typeof cogsTotal === 'number') {
    lines.push(makeLineItem('gross_profit', 'Gross Profit', revTotal - cogsTotal, period, 0, true))
  }

  if (data.opex && typeof data.opex === 'object')
    lines.push(...sectionLines(data.opex as Record<string, unknown>, 'opex', 'Operating Expenses', period))

  if (typeof data.ebitda === 'number')
    lines.push(makeLineItem('ebitda', 'EBITDA', data.ebitda as number, period, 0, true))
  if (typeof data.depreciation_amortization === 'number')
    lines.push(makeLineItem('da', 'D&A', data.depreciation_amortization as number, period, 1))
  if (typeof data.operating_profit === 'number')
    lines.push(makeLineItem('operating_profit', 'Operating Profit', data.operating_profit as number, period, 0, true))
  if (typeof data.tax === 'number')
    lines.push(makeLineItem('tax', 'Tax', data.tax as number, period, 1))
  if (typeof data.net_income === 'number')
    lines.push(makeLineItem('net_income', 'Net Income', data.net_income as number, period, 0, true))

  return { title: 'Income Statement', entity, periods: [period], line_items: lines, currency: 'USD', unit: '$M' }
}

function transformBalanceSheet(
  data: Record<string, unknown>,
  period: string,
): FinancialStatementData {
  const entity = (data.entity_id as string) || 'unknown'
  const lines: FinancialStatementLineItem[] = []

  if (data.assets && typeof data.assets === 'object')
    lines.push(...sectionLines(data.assets as Record<string, unknown>, 'assets', 'Assets', period))
  if (data.liabilities && typeof data.liabilities === 'object')
    lines.push(...sectionLines(data.liabilities as Record<string, unknown>, 'liabilities', 'Liabilities', period))
  if (data.equity && typeof data.equity === 'object')
    lines.push(...sectionLines(data.equity as Record<string, unknown>, 'equity', 'Equity', period))

  return { title: 'Balance Sheet', entity, periods: [period], line_items: lines, currency: 'USD', unit: '$M' }
}

function transformCashFlow(
  data: Record<string, unknown>,
  period: string,
): FinancialStatementData {
  const entity = (data.entity_id as string) || 'unknown'
  const lines: FinancialStatementLineItem[] = []

  if (data.operating && typeof data.operating === 'object')
    lines.push(...sectionLines(data.operating as Record<string, unknown>, 'cf_operating', 'Operating Activities', period))
  if (data.investing && typeof data.investing === 'object')
    lines.push(...sectionLines(data.investing as Record<string, unknown>, 'cf_investing', 'Investing Activities', period))
  if (data.financing && typeof data.financing === 'object')
    lines.push(...sectionLines(data.financing as Record<string, unknown>, 'cf_financing', 'Financing Activities', period))

  if (typeof data.net_change === 'number')
    lines.push(makeLineItem('net_change', 'Net Change in Cash', data.net_change as number, period, 0, true))

  return { title: 'Cash Flow Statement', entity, periods: [period], line_items: lines, currency: 'USD', unit: '$M' }
}

const STATEMENT_TRANSFORMS: Record<string, (data: Record<string, unknown>, period: string) => FinancialStatementData> = {
  income_statement: transformIncomeStatement,
  balance_sheet: transformBalanceSheet,
  cash_flow: transformCashFlow,
}

export async function fetchReport(
  statement: 'income_statement' | 'balance_sheet' | 'cash_flow',
  _variant: ReportVariant,
  quarter?: string,
  segment?: string | null,
  entity?: EntitySelection,
): Promise<{ reportData: ReportData; pyReportData: ReportData | null; rawFSData: FinancialStatementData }> {
  const endpointPath = STATEMENT_ENDPOINTS[statement]
  if (!endpointPath) {
    throw new Error(`Unknown statement type: ${statement}`)
  }

  const params = await withTenant()
  if (quarter) params.set('period', quarter)

  let data: Record<string, unknown>

  if (entity === 'combined') {
    // Combined view: call the combining endpoint and extract the combined column.
    // The combining endpoint returns { entity_a, entity_b, adjustments, combined }
    // where combined has the same financial dict shape as single-entity responses.
    const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/combining/${endpointPath}?${params}`)
    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error')
      throw new Error(
        `Report query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`
      )
    }
    const combiningData = await res.json()
    if (!combiningData.combined || typeof combiningData.combined !== 'object') {
      throw new Error(
        `Combining endpoint did not return combined data. Response keys: ${Object.keys(combiningData).join(', ')}`
      )
    }
    data = { ...combiningData.combined, entity_id: 'combined' }
  } else {
    // Single-entity view requires entity_id
    if (entity) {
      params.set('entity_id', entity)
    } else {
      const ctx = await getEngagementContext()
      params.set('entity_id', ctx.entity_a.id)
    }
    const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/${endpointPath}?${params}`)
    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error')
      throw new Error(
        `Report query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`
      )
    }
    data = await res.json()
  }

  // Convergence returns raw financial dicts (revenue: {total, ...}, cogs: {...}).
  // Transform into the FinancialStatementData shape the portal expects.
  const period = quarter || (data.period as string) || '2025-Q1'
  const transform = STATEMENT_TRANSFORMS[statement]
  const fsData = transform(data, period)

  const seg = segment ?? null

  return {
    reportData: transformToReportData(fsData, seg),
    pyReportData: null,
    rawFSData: fsData,
  }
}

// ── Dimensional Detail (drill-through) ──────────────────────────────────────

export interface DimensionalDetailItem {
  property: string
  value: number
  pct_of_total: number | null
}

export interface DimensionalSection {
  name: string
  items: DimensionalDetailItem[]
  total: number
}

export interface DimensionalDetailResponse {
  line_key: string
  entity_id: string
  dimensions: DimensionalSection[]
}

export async function fetchDimensionalDetail(
  lineKey: string,
  entityId: string,
  period?: string,
): Promise<DimensionalDetailResponse> {
  const params = await withTenant(new URLSearchParams({ line_key: lineKey, entity_id: entityId }))
  if (period) params.set('period', period)

  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/dimensional-detail?${params}`)

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(
      `Dimensional detail query failed (HTTP ${res.status}) for ${lineKey}: ${sanitizeErrorMessage(errText.slice(0, 500))}`
    )
  }

  return res.json()
}

// ── Combining Statement ───────────────────────────────────────────────────

export async function fetchCombiningStatement(
  period: string,
  segment?: string | null,
): Promise<CombiningStatementData> {
  const params = await withTenant(new URLSearchParams({ period }))
  if (segment) params.set('segment', segment)

  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/combining/income-statement?${params}`)

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(
      `Combining statement query failed (HTTP ${res.status}) for period=${period}: ${sanitizeErrorMessage(errText.slice(0, 500))}`
    )
  }

  const raw = await res.json()

  // The backend returns structured objects (entity_a, entity_b, adjustments,
  // combined) with nested financial metrics. Transform into the flat
  // line_items array the CombiningStatement component expects.
  return transformCombiningResponse(raw, period)
}

/**
 * Transform the Convergence combining engine response into the flat
 * CombiningStatementData shape expected by the CombiningStatement UI.
 *
 * Backend shape:
 *   entity_a/entity_b: { name, revenue: {total,...}, cogs: {total,...},
 *     opex: {total,...}, ebitda, operating_profit, depreciation_amortization,
 *     tax, net_income }
 *   adjustments: { revenue: {total}, cogs: {total}, opex: {total},
 *     depreciation: {total}, total_ebitda_impact }
 *   combined: same shape as entity_a/entity_b
 */
function transformCombiningResponse(
  raw: Record<string, unknown>,
  period: string,
): CombiningStatementData {
  const ea = raw.entity_a as Record<string, unknown> | undefined
  const eb = raw.entity_b as Record<string, unknown> | undefined
  const adj = raw.adjustments as Record<string, unknown> | undefined
  const comb = raw.combined as Record<string, unknown> | undefined

  if (!ea || !eb || !comb) {
    throw new Error(
      'Combining statement response missing entity_a, entity_b, or combined. ' +
      `Response keys: ${Object.keys(raw).join(', ')}`
    )
  }

  function num(obj: Record<string, unknown> | undefined, key: string): number {
    if (!obj) return 0
    const val = obj[key]
    if (typeof val === 'number') return val
    if (val && typeof val === 'object' && 'total' in (val as Record<string, unknown>)) {
      return (val as Record<string, unknown>).total as number
    }
    return 0
  }

  function adjNum(key: string): number {
    if (!adj) return 0
    const section = adj[key]
    if (typeof section === 'number') return section
    if (section && typeof section === 'object' && 'total' in (section as Record<string, unknown>)) {
      return (section as Record<string, unknown>).total as number
    }
    return 0
  }

  const line_items = [
    {
      line_item: 'Total Revenue',
      meridian: num(ea, 'revenue'),
      cascadia: num(eb, 'revenue'),
      adjustments: adjNum('revenue'),
      combined: num(comb, 'revenue'),
    },
    {
      line_item: 'Total COGS',
      meridian: num(ea, 'cogs'),
      cascadia: num(eb, 'cogs'),
      adjustments: adjNum('cogs'),
      combined: num(comb, 'cogs'),
    },
    {
      line_item: 'Gross Profit',
      meridian: num(ea, 'revenue') - num(ea, 'cogs'),
      cascadia: num(eb, 'revenue') - num(eb, 'cogs'),
      adjustments: adjNum('revenue') - adjNum('cogs'),
      combined: num(comb, 'revenue') - num(comb, 'cogs'),
    },
    {
      line_item: 'Total OpEx',
      meridian: num(ea, 'opex'),
      cascadia: num(eb, 'opex'),
      adjustments: adjNum('opex'),
      combined: num(comb, 'opex'),
    },
    {
      line_item: 'EBITDA',
      meridian: num(ea, 'ebitda'),
      cascadia: num(eb, 'ebitda'),
      adjustments: adjNum('total_ebitda_impact'),
      combined: num(comb, 'ebitda'),
    },
    {
      line_item: 'D&A',
      meridian: num(ea, 'depreciation_amortization'),
      cascadia: num(eb, 'depreciation_amortization'),
      adjustments: adjNum('depreciation'),
      combined: num(comb, 'depreciation_amortization'),
    },
    {
      line_item: 'Operating Profit',
      meridian: num(ea, 'operating_profit'),
      cascadia: num(eb, 'operating_profit'),
      adjustments: adjNum('total_ebitda_impact') - adjNum('depreciation'),
      combined: num(comb, 'operating_profit'),
    },
    {
      line_item: 'Tax',
      meridian: num(ea, 'tax'),
      cascadia: num(eb, 'tax'),
      adjustments: 0,
      combined: num(comb, 'tax'),
    },
    {
      line_item: 'Net Income',
      meridian: num(ea, 'net_income'),
      cascadia: num(eb, 'net_income'),
      adjustments: adjNum('total_ebitda_impact') - adjNum('depreciation'),
      combined: num(comb, 'net_income'),
    },
  ]

  return { period: raw.period as string ?? period, line_items }
}

// ── Entity Overlap ────────────────────────────────────────────────────────

export async function fetchOverlapSummary(): Promise<OverlapSummary> {
  const params = await withTenant()
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/overlap/summary?${params}`)

  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(
      `Entity overlap query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`
    )
  }

  return res.json()
}

// ── Cross-Sell Pipeline ──────────────────────────────────────────────────────

export async function fetchCrossSell(): Promise<CrossSellData> {
  const params = await withTenant()
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/cross-sell?${params}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(`Cross-sell query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`)
  }
  const raw = await res.json()
  return transformCrossSellResponse(raw)
}

function transformCrossSellResponse(raw: Record<string, unknown>): CrossSellData {
  const opportunities = (raw.opportunities as Array<Record<string, unknown>>) || []
  const ctx_entity_a = (raw.entity_pair as string[])?.[0] || ''

  const m_to_c: import('./types').CrossSellCandidate[] = []
  const c_to_m: import('./types').CrossSellCandidate[] = []

  for (const opp of opportunities) {
    const candidate: import('./types').CrossSellCandidate = {
      customer_id: opp.customer_id as string,
      customer_name: opp.customer_name as string,
      entity_id: opp.current_entity as string,
      recommended_service: opp.recommended_service as string,
      propensity_score: opp.propensity_score as number,
      estimated_acv: opp.estimated_acv as number,
      industry_match: opp.industry_match as number,
      size_match: opp.size_match as number,
      behavioral_score: opp.behavioral_score as number,
      engagement_fit: opp.engagement_fit as number,
      relationship_strength: opp.relationship_strength as number,
      rationale: opp.rationale as string,
      comparable_customers: opp.comparable_customers as string[],
      buyer_persona: opp.buyer_persona as string,
      customer_engagement_M: opp.customer_engagement_M as number,
      years_as_client: opp.years_as_client as number,
      industry: opp.industry as string,
      segment: opp.segment as string,
    }
    if (opp.current_entity === ctx_entity_a) {
      m_to_c.push(candidate)
    } else {
      c_to_m.push(candidate)
    }
  }

  const HIGH_CONF_THRESHOLD = 80
  const m2cHigh = m_to_c.filter(c => c.propensity_score >= HIGH_CONF_THRESHOLD)
  const c2mHigh = c_to_m.filter(c => c.propensity_score >= HIGH_CONF_THRESHOLD)
  const sumAcv = (arr: import('./types').CrossSellCandidate[]) => arr.reduce((s, c) => s + c.estimated_acv, 0)

  return {
    m_to_c,
    c_to_m,
    summary: {
      m_to_c_candidates: m_to_c.length,
      m_to_c_total_acv: sumAcv(m_to_c),
      m_to_c_high_conf_count: m2cHigh.length,
      m_to_c_high_conf_acv: sumAcv(m2cHigh),
      c_to_m_candidates: c_to_m.length,
      c_to_m_total_acv: sumAcv(c_to_m),
      c_to_m_high_conf_count: c2mHigh.length,
      c_to_m_high_conf_acv: sumAcv(c2mHigh),
      total_candidates: opportunities.length,
      total_pipeline_acv: sumAcv(m_to_c) + sumAcv(c_to_m),
      total_high_conf_acv: sumAcv(m2cHigh) + sumAcv(c2mHigh),
    },
  }
}

// ── Upsell Pipeline ─────────────────────────────────────────────────────────

export async function fetchUpsell(): Promise<UpsellData> {
  const params = await withTenant()
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/upsell?${params}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(`Upsell query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`)
  }
  const raw = await res.json()
  return transformUpsellResponse(raw)
}

function transformUpsellResponse(raw: Record<string, unknown>): UpsellData {
  const opportunities = (raw.opportunities as Array<Record<string, unknown>>) || []
  const ctx_entity_a = (raw.entity_pair as string[])?.[0] || ''

  const m_to_c: import('./types').UpsellCandidate[] = []
  const c_to_m: import('./types').UpsellCandidate[] = []

  for (const opp of opportunities) {
    const candidate: import('./types').UpsellCandidate = {
      customer_id: opp.customer_id as string,
      customer_name: opp.customer_name as string,
      source_entity: opp.source_entity as string,
      target_entity: opp.target_entity as string,
      gap_service: opp.gap_service as string,
      gap_service_name: opp.gap_service_name as string,
      typical_acv: opp.typical_acv as number,
      upsell_score: opp.upsell_score as number,
      relationship_strength: opp.relationship_strength as number,
      service_adjacency: (opp.service_adjacency as number) || 0,
      revenue_potential: (opp.revenue_potential as number) || 0,
      contract_recency: (opp.contract_recency as number) || 0,
      current_services: (opp.current_services as string[]) || [],
      current_engagement_revenue_M: (opp.current_engagement_revenue_M as number) || 0,
      satisfaction_score: (opp.satisfaction_score as number) || 0,
      contract_type: (opp.contract_type as string) || '',
      engagement_start_year: (opp.engagement_start_year as number) || 0,
      match_type: (opp.match_type as string) || '',
      rationale: (opp.rationale as string) || '',
    }
    if (opp.source_entity === ctx_entity_a) {
      m_to_c.push(candidate)
    } else {
      c_to_m.push(candidate)
    }
  }

  const allCustomers = new Set(opportunities.map(o => o.customer_id as string))
  const sumAcv = (arr: import('./types').UpsellCandidate[]) => arr.reduce((s, c) => s + c.typical_acv, 0)
  const allScores = opportunities.map(o => (o.upsell_score as number) || 0)
  const avgScore = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0

  return {
    m_to_c,
    c_to_m,
    summary: {
      total_shared_customers: allCustomers.size,
      total_opportunities: opportunities.length,
      total_expansion_acv: sumAcv(m_to_c) + sumAcv(c_to_m),
      avg_score: avgScore,
      m_to_c_count: m_to_c.length,
      m_to_c_acv: sumAcv(m_to_c),
      c_to_m_count: c_to_m.length,
      c_to_m_acv: sumAcv(c_to_m),
    },
  }
}

// ── Revenue by Customer ──────────────────────────────────────────────────────

export async function fetchRevenueByCustomer(entityId: string): Promise<RevenueByCustomerData> {
  const params = await withTenant(new URLSearchParams({ entity_id: entityId }))
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/revenue-by-customer?${params}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(`Revenue by customer query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`)
  }
  return res.json()
}

// ── EBITDA Bridge ────────────────────────────────────────────────────────────

export async function fetchEBITDABridge(): Promise<EBITDABridgeData> {
  const params = await withTenant()
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/bridge/comparison?${params}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(`EBITDA bridge query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`)
  }
  const raw = await res.json()

  const bridgeA = raw.entity_a
  const bridgeB = raw.entity_b
  const combined = raw.combined
  const [eA, eB] = raw.entity_pair || ['entity_a', 'entity_b']

  function confTier(c: number): string {
    if (c >= 0.85) return 'high'
    if (c >= 0.65) return 'medium'
    return 'low'
  }

  function mapAdj(a: Record<string, unknown>): BridgeAdjustment {
    return {
      name: String(a.name || ''),
      category: String(a.lever || 'normalization'),
      entity: 'combined',
      confidence: confTier(typeof a.confidence === 'number' ? a.confidence : 0),
      amount: Number(a.amount) || 0,
      amount_low: Number(a.amount_low) || 0,
      amount_high: Number(a.amount_high) || 0,
      lever: a.lever ? String(a.lever) : null,
      support_reference: String(a.support_reference || ''),
      rationale: String(a.rationale || ''),
    }
  }

  const allAdj = (combined.adjustments || []).map(mapAdj)
  const entityAdjustments = allAdj.filter((a: BridgeAdjustment) => a.category !== 'synergy')
  const combinationSynergies = allAdj.filter((a: BridgeAdjustment) => a.category === 'synergy')

  const entityAdjTotal = entityAdjustments.reduce((s: number, a: BridgeAdjustment) => s + a.amount, 0)
  const synergyTotal = combinationSynergies.reduce((s: number, a: BridgeAdjustment) => s + a.amount, 0)
  const synergyLow = combinationSynergies.reduce((s: number, a: BridgeAdjustment) => s + a.amount_low, 0)
  const synergyHigh = combinationSynergies.reduce((s: number, a: BridgeAdjustment) => s + a.amount_high, 0)

  const reportedCombined: number = combined.reported_ebitda
  const entityAdjCombined = Math.round((reportedCombined + entityAdjTotal) * 100) / 100
  const entityAdjA = Math.round((bridgeA.reported_ebitda + (bridgeA.by_lever?.normalization || 0) + (bridgeA.by_lever?.cost_reduction || 0)) * 100) / 100
  const entityAdjB = Math.round((bridgeB.reported_ebitda + (bridgeB.by_lever?.normalization || 0) + (bridgeB.by_lever?.cost_reduction || 0)) * 100) / 100

  const pfCurrent = Math.round((entityAdjCombined + synergyTotal) * 100) / 100
  const pfLow = Math.round((entityAdjCombined + synergyLow) * 100) / 100
  const pfHigh = Math.round((entityAdjCombined + synergyHigh) * 100) / 100

  const EV_MULTIPLE = 12.5

  return {
    reported_ebitda: Object.assign(
      { combined_reported: reportedCombined },
      { [eA]: bridgeA.reported_ebitda, [eB]: bridgeB.reported_ebitda },
    ) as EBITDABridgeData['reported_ebitda'],
    entity_adjustments: entityAdjustments,
    entity_adjusted_ebitda: Object.assign(
      { combined: entityAdjCombined },
      { [eA]: entityAdjA, [eB]: entityAdjB },
    ) as EBITDABridgeData['entity_adjusted_ebitda'],
    combination_synergies: combinationSynergies,
    pro_forma_ebitda: {
      year_1: { low: pfLow, high: pfHigh, current: pfCurrent },
      steady_state: { low: pfLow, high: pfHigh, current: pfCurrent },
    },
    ev_impact: {
      multiple: EV_MULTIPLE,
      year_1_ev: { low: Math.round(pfLow * EV_MULTIPLE * 100) / 100, high: Math.round(pfHigh * EV_MULTIPLE * 100) / 100, current: Math.round(pfCurrent * EV_MULTIPLE * 100) / 100 },
      steady_state_ev: { low: Math.round(pfLow * EV_MULTIPLE * 100) / 100, high: Math.round(pfHigh * EV_MULTIPLE * 100) / 100, current: Math.round(pfCurrent * EV_MULTIPLE * 100) / 100 },
    },
  }
}

// ── What-If Engine ───────────────────────────────────────────────────────────

/**
 * Convergence what-if endpoint expects:
 *   POST /api/convergence/reports/v2/whatif/scenario
 *   Body: { entity_id, period, adjustments: [{ concept, type, value }] }
 *
 * The frontend operates on percentage-based levers (revenue ±20%, cogs ±20%, etc.).
 * Levers are transformed into the Convergence adjustments array format.
 * entity_id and period default from the engagement context if not provided.
 */
export async function fetchWhatIf(
  levers?: Record<string, number>,
  _preset?: string,
  entityId?: string,
  period?: string,
): Promise<WhatIfResult> {
  const ctx = await getEngagementContext()
  const resolvedEntityId = entityId || ctx.entity_a.id
  const resolvedPeriod = period || '2025-Q4'

  const adjustments: Array<{ concept: string; type: string; value: number }> = []
  if (levers) {
    for (const [concept, value] of Object.entries(levers)) {
      if (value !== 0) {
        adjustments.push({ concept, type: 'pct', value })
      }
    }
  }

  const body = { entity_id: resolvedEntityId, period: resolvedPeriod, adjustments }

  const params = await withTenant()
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/whatif/scenario?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(`What-if query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`)
  }
  const raw = await res.json()
  return transformWhatIfResponse(raw, levers || {})
}

function transformWhatIfResponse(
  raw: Record<string, unknown>,
  currentLevers: Record<string, number>,
): WhatIfResult {
  const baseline = raw.baseline as Record<string, unknown>
  const adjusted = raw.adjusted as Record<string, unknown>

  const baseEbitda = (baseline.ebitda as number) || 0
  const adjEbitda = (adjusted.ebitda as number) || 0
  const baseRevenue = (baseline.revenue as Record<string, unknown>)?.total as number || 0
  const baseCogs = (baseline.cogs as Record<string, unknown>)?.total as number || 0
  const baseOpex = (baseline.opex as Record<string, unknown>)?.total as number || 0

  // Build lever definitions from baseline financial concepts
  const lever_definitions: import('./types').LeverDefinition[] = [
    { name: 'revenue', label: 'Revenue', min: -20, max: 20, default: 0, unit: '%', impact_per_point_M: baseRevenue / 100 },
    { name: 'cogs', label: 'COGS', min: -20, max: 20, default: 0, unit: '%', impact_per_point_M: baseCogs / 100 },
    { name: 'opex', label: 'OpEx', min: -20, max: 20, default: 0, unit: '%', impact_per_point_M: baseOpex / 100 },
  ]

  // Initialize levers from current values or defaults
  const levers: Record<string, number> = {}
  for (const def of lever_definitions) {
    levers[def.name] = currentLevers[def.name] ?? def.default
  }

  return {
    levers,
    lever_definitions,
    reported_ebitda: baseEbitda,
    entity_adjusted_ebitda: adjEbitda,
    adjustments: [],
    synergies: [],
    pro_forma_ebitda: { year_1: adjEbitda, steady_state: adjEbitda },
    ev_impact: { year_1: adjEbitda * 8, steady_state: adjEbitda * 8 },
    ev_multiple: 8,
    presets: {
      bull_case: { revenue: 10, cogs: -5, opex: -5 },
      bear_case: { revenue: -10, cogs: 5, opex: 5 },
      base_case: { revenue: 0, cogs: 0, opex: 0 },
    },
    base_revenue: baseRevenue,
    base_cogs: baseCogs,
    base_opex: baseOpex,
  }
}

// ── Quality of Earnings ──────────────────────────────────────────────────────

export async function fetchQofE(): Promise<QofEData> {
  const params = await withTenant()
  // QofE tab only shows for combined entity — use the combined endpoint
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/qoe/combined?${params}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(`QofE query failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`)
  }
  const raw = await res.json()
  return transformQofEResponse(raw)
}

function transformQofEResponse(raw: Record<string, unknown>): QofEData {
  const combined = raw.combined as Record<string, unknown> || {}
  const bridge = raw.bridge as Record<string, unknown> || {}

  const reportedEbitda = (bridge.reported_ebitda as number) || (combined.reported_ebitda as number) || 0
  const adjustedEbitda = (bridge.adjusted_ebitda as number) || (combined.adjusted_ebitda as number) || 0
  const totalAdj = (bridge.total_adjustments as number) || 0

  // Transform bridge adjustments into QofEAdjustmentRow[]
  const bridgeAdjs = (bridge.adjustments as Array<Record<string, unknown>>) || []
  const ebitda_bridge: import('./types').QofEAdjustmentRow[] = bridgeAdjs.map(a => {
    // Backend confidence is a decimal (0.7), frontend expects a string label
    const confNum = typeof a.confidence === 'number' ? a.confidence : 0
    const confLabel = confNum >= 0.8 ? 'high' : confNum >= 0.5 ? 'medium' : 'low'
    return {
      name: a.name as string,
      category: (a.category as string) || (a.lever as string) || 'adjustment',
      entity: (a.entity as string) || 'combined',
      confidence: confLabel,
      current_amount: (a.amount as number) || 0,
      diligence_amount: (a.diligence_amount as number) ?? null,
      prior_amount: (a.prior_amount as number) ?? null,
      amount_low: (a.amount_low as number) || (a.amount as number) || 0,
      amount_high: (a.amount_high as number) || (a.amount as number) || 0,
      lever: (a.lever as string) || null,
      support_reference: (a.support_reference as string) || '',
      rationale: (a.rationale as string) || '',
      status: 'active' as const,
      lifecycle_stage: (a.lifecycle_stage as string) || 'management',
      trend: (a.trend as string as 'improving' | 'stable' | 'worsening') || 'stable',
    }
  })

  // Sustainability score from combined.sustainability_trend (use latest)
  const susTrend = (combined.sustainability_trend as Array<Record<string, unknown>>) || []
  const latestSus = susTrend.length > 0 ? susTrend[susTrend.length - 1] : null
  const susScore = latestSus ? (latestSus.score as number) || 0 : 0
  const susGrade = latestSus ? (latestSus.grade as string) || 'N/A' : 'N/A'

  const sustainability_score: import('./types').QofESustainabilityScore = {
    overall: susScore,
    components: [
      { name: 'Earnings Quality', score: Math.round(susScore * 0.4), weight: 40, max_points: 40 },
      { name: 'Revenue Quality', score: Math.round(susScore * 0.3), weight: 30, max_points: 30 },
      { name: 'Working Capital', score: Math.round(susScore * 0.3), weight: 30, max_points: 30 },
    ],
    grade: susGrade,
  }

  // Revenue quality from combined (merged both entities' customers + streams)
  const rqRaw = (combined.revenue_quality as Record<string, unknown>) || {}
  const ccRaw = (rqRaw.customer_concentration as Record<string, unknown>) || {}
  const cqRaw = (rqRaw.contract_quality as Record<string, unknown>) || {}
  const rmRaw = (rqRaw.revenue_mix as Record<string, unknown>) || {}
  const crRaw = (rqRaw.cohort_retention as Array<Record<string, unknown>>) || []
  const csRaw = (rqRaw.cross_sell_penetration as Record<string, unknown>) || {}
  const taRaw = (ccRaw.threshold_alerts as Array<Record<string, unknown>>) || []

  const revenue_quality: QofEData['revenue_quality'] = {
    customer_concentration: {
      hhi: (ccRaw.hhi as number) || 0,
      top_10_pct: (ccRaw.top_10_pct as number) || 0,
      top_20_pct: (ccRaw.top_20_pct as number) || 0,
      top_50_pct: (ccRaw.top_50_pct as number) || 0,
      threshold_alerts: taRaw.map(a => ({
        customer: (a.customer as string) || '',
        pct: (a.pct as number) || 0,
        threshold: (a.threshold as string) || '',
      })),
      total_customers: (ccRaw.total_customers as number) || 0,
    },
    contract_quality: {
      msa_pct: (cqRaw.msa_pct as number) || 0,
      sow_pct: (cqRaw.sow_pct as number) || 0,
      t_and_m_pct: (cqRaw.t_and_m_pct as number) || 0,
      avg_tenure_years: (cqRaw.avg_tenure_years as number) || 0,
    },
    revenue_mix: {
      recurring_pct: (rmRaw.recurring_pct as number) || 0,
      non_recurring_pct: (rmRaw.non_recurring_pct as number) || 0,
      consulting_tm_M: (rmRaw.consulting_tm_M as number) || 0,
      managed_services_M: (rmRaw.managed_services_M as number) || 0,
      per_fte_M: (rmRaw.per_fte_M as number) || 0,
      per_transaction_M: (rmRaw.per_transaction_M as number) || 0,
      fixed_fee_M: (rmRaw.fixed_fee_M as number) || 0,
    },
    cohort_retention: crRaw.map(c => ({
      years_as_client: (c.years_as_client as number) || 0,
      total_revenue_M: (c.total_revenue_M as number) || 0,
    })),
    cross_sell_penetration: {
      total_candidates: (csRaw.total_candidates as number) || 0,
      total_pipeline_acv_M: (csRaw.total_pipeline_acv_M as number) || 0,
      converted_count: (csRaw.converted_count as number) || 0,
      converted_acv_M: (csRaw.converted_acv_M as number) || 0,
      conversion_rate_pct: (csRaw.conversion_rate_pct as number) || 0,
    },
  }

  // Margin trend from combined
  const marginTrend = (combined.margin_trend as Array<Record<string, unknown>>) || []
  const working_capital: QofEData['working_capital'] = {
    dso_trend: [],
    dpo_trend: [],
    bench_cost_trend: [],
    working_capital_pct_trend: [],
    margin_trend: marginTrend.map(m => ({
      period: m.period as string,
      gross_margin_pct: 0,
      ebitda_margin_pct: (m.ebitda_margin as number) || 0,
    })),
  }

  // Adjustment lifecycle from combined
  const alcRaw = (combined.adjustment_lifecycle as Record<string, unknown>) || {}
  const lifecycleStages: Record<string, { count: number; items: string[] }> = {}
  let totalAdjustmentCount = 0
  for (const [concept, stages] of Object.entries(alcRaw)) {
    const stageArr = stages as Array<Record<string, unknown>>
    for (const s of stageArr) {
      const stage = s.stage as string
      if (!lifecycleStages[stage]) lifecycleStages[stage] = { count: 0, items: [] }
      lifecycleStages[stage].count += 1
      lifecycleStages[stage].items.push(concept)
      totalAdjustmentCount += 1
    }
  }

  return {
    period: '2025',
    is_initial_diligence: true,
    ebitda_bridge,
    adjustment_lifecycle: {
      lifecycle_stages: lifecycleStages,
      status_counts: { active: ebitda_bridge.length, resolved: 0, new: 0 },
      total_adjustments: totalAdjustmentCount,
    },
    revenue_quality,
    sustainability_score,
    working_capital,
    new_items: [],
    summary: {
      reported_ebitda: reportedEbitda,
      entity_adjusted_ebitda: adjustedEbitda,
      pro_forma_year_1: adjustedEbitda,
      pro_forma_steady_state: adjustedEbitda,
      total_adjustments: totalAdj,
      active_adjustments: ebitda_bridge.length,
      resolved_adjustments: 0,
      new_adjustments: 0,
      changed_adjustments: 0,
      sustainability_score: susScore,
      sustainability_grade: susGrade,
    },
  }
}

// ── Pipeline Report ─────────────────────────────────────────────────────────

export async function fetchPipelineReport(
  period: string,
  entityId?: string,
): Promise<PipelineReportData[]> {
  const params = await withTenant(new URLSearchParams({ period }))
  if (entityId) params.set('entity_id', entityId)
  const res = await fetch(`${CONVERGENCE_REPORTS_BASE}/pipeline?${params}`)
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error')
    throw new Error(`Pipeline report failed (HTTP ${res.status}): ${sanitizeErrorMessage(errText.slice(0, 500))}`)
  }
  const raw = await res.json()
  // Backend wraps pipeline data in { ..., panels: [...] }
  return (raw.panels as PipelineReportData[]) || raw
}
