import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fetchReport, fetchDimensionalDetail, fetchCombiningStatement, fetchCrossSell, fetchUpsell, fetchRevenueByCustomer, fetchEBITDABridge, fetchWhatIf, fetchQofE, fetchReportDimensions, fetchPipelineReport, fetchOverlapSummary, getEngagementContext } from "./api";
import type { PeriodDimension, DimensionalDetailResponse } from "./api";
import React from "react";
import type { ReportData, ReportVariant, EntitySelection, CombiningStatementData, CrossSellData, UpsellData, RevenueByCustomerData, EBITDABridgeData, BridgeAdjustment, WhatIfResult, QofEData, FinancialStatementData, FinancialStatementLineItem, PipelineReportData, OverlapSummary } from "./types";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer,
  PieChart, Pie,
} from "recharts";

const SalesFunnel = React.lazy(() => import("../sales-funnel/SalesFunnel"));

// ============================================================
// FORMATTING
// ============================================================
function fmt(n: number | null | undefined, isPercent = false): string {
  if (n === null || n === undefined) return "";
  if (isPercent) return n.toFixed(1) + "%";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return n < 0 ? `(${s})` : s;
}

function fmtFull(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return n < 0 ? `($${s})` : `$${s}`;
}

function variancePct(act: number, py: number): string {
  if (!py || py === 0) return "\u2014";
  const pct = ((act - py) / Math.abs(py)) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function fmtDollar(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "\u2014";
  // DCL returns all financial values in $M. Auto-scale for display.
  const absM = Math.abs(n);
  let formatted: string;
  if (absM >= 1000) {
    const b = absM / 1000;
    formatted = `$${b.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`;
  } else if (absM >= 0.1) {
    const mDec = absM < 10 ? 1 : 0;
    formatted = `$${absM.toLocaleString("en-US", { minimumFractionDigits: mDec, maximumFractionDigits: mDec })}M`;
  } else {
    const k = absM * 1000;
    formatted = `$${k.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}K`;
  }
  return n < 0 ? `(${formatted})` : formatted;
}

function fmtDollarM(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "\u2014";
  // Always display in $M — never auto-scale to $B.
  // This keeps lever movements visible (e.g. $1,250M not $1.3B).
  const absM = Math.abs(n);
  let formatted: string;
  if (absM >= 1) {
    formatted = `$${Math.round(absM).toLocaleString("en-US")}M`;
  } else {
    const k = absM * 1000;
    formatted = `$${k.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}K`;
  }
  return n < 0 ? `(${formatted})` : formatted;
}

function fmtScore(n: number): string {
  if (n >= 80) return "HIGH";
  if (n >= 60) return "MED";
  return "LOW";
}

function confidenceColor(c: string): string {
  if (c === "high") return COLORS.green;
  if (c === "medium") return COLORS.accent;
  return COLORS.red;
}

// ============================================================
// CONSTANTS
// ============================================================
// QUARTERS and SEGMENTS are now fetched dynamically from /api/convergence/reports/v2/dimensions
const SEGMENTS_FALLBACK = ["Strategy", "Operations", "Technology", "Risk", "Digital/AI", "Commercial"];

function wallClockDate() { return new Date(); }

const COLORS = {
  bg: "#0F1117",
  surface: "#181B25",
  surfaceHover: "#1E2230",
  border: "#2A2E3B",
  borderLight: "#353945",
  text: "#E8E9ED",
  textMuted: "#8B8F9E",
  textDim: "#5A5E6E",
  accent: "#C77840",
  accentLight: "#D4915A",
  green: "#4CAF50",
  greenBg: "rgba(76,175,80,0.08)",
  red: "#EF5350",
  redBg: "rgba(239,83,80,0.08)",
  blue: "#5B8DEF",
  highlight: "rgba(199,120,64,0.06)",
  headerBg: "#141720",
  totalBg: "rgba(255,255,255,0.02)",
};

const CONTENT_MAX_WIDTH = 1024;

// ============================================================
// VARIANT MAPPING — portal variant keys → API ReportVariant
// ============================================================
function mapVariant(v: string): ReportVariant {
  switch (v) {
    case "act_vs_py": return "full_year_act_vs_py";
    case "q_act_vs_py": return "quarterly_act_vs_py";
    case "cf_vs_py": return "full_year_cf_vs_py_act";
    case "q_cf_vs_py": return "quarterly_cf_vs_py";
    case "quarterly": return "quarterly_act_vs_py";
    default: return "full_year_act_vs_py";
  }
}

function tabToStatement(tab: string): "income_statement" | "balance_sheet" | "cash_flow" {
  if (tab === "bs") return "balance_sheet";
  if (tab === "cf") return "cash_flow";
  return "income_statement";
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  width?: number;
}

function Select({ value, onChange, options, label, width = 180 }: SelectProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <span style={{ fontSize: 15, color: COLORS.textMuted, letterSpacing: "0.05em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>
          {label}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width, padding: "8px 12px", background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}`,
          borderRadius: 6, fontSize: 15, fontFamily: "'IBM Plex Sans',sans-serif", cursor: "pointer", outline: "none",
          appearance: "none" as const,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238B8F9E' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 30,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function TabBar({ tabs, active, onChange, noBorder }: { tabs: { id: string; label: string; title?: string }[]; active: string; onChange: (id: string) => void; noBorder?: boolean }) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div style={{
        display: "flex", gap: 2,
        borderBottom: noBorder ? "none" : `1px solid ${COLORS.border}`,
        overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none" as any,
      }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => onChange(t.id)} title={t.title || t.label} style={{
            padding: "8px 14px", background: active === t.id ? COLORS.surface : "transparent",
            color: active === t.id ? COLORS.accent : COLORS.textMuted, border: "none",
            borderBottom: active === t.id ? `2px solid ${COLORS.accent}` : "2px solid transparent",
            cursor: "pointer", fontSize: 15, fontFamily: "'IBM Plex Sans',sans-serif",
            fontWeight: active === t.id ? 600 : 400, transition: "all 0.15s", letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 40,
        background: `linear-gradient(to right, transparent, ${COLORS.headerBg})`,
        pointerEvents: "none",
      }} />
    </div>
  );
}

function unitLabel(unit?: string): string {
  if (!unit) return "";
  const u = unit.toLowerCase();
  if (u === "millions") return "($MM)";
  if (u === "billions") return "($BN)";
  if (u === "thousands") return "($K)";
  return `(${unit})`;
}

function StatementTable({ data, pyData, showVariance = true, entityId, period, fsData }: {
  data: ReportData | null; pyData: ReportData | null; showVariance?: boolean;
  entityId: string; period: string; fsData: FinancialStatementData | null;
}) {
  const [expandedLine, setExpandedLine] = useState<{ id: string; name: string } | null>(null);
  const [dimData, setDimData] = useState<DimensionalDetailResponse | null>(null);
  const [dimLoading, setDimLoading] = useState(false);
  const [dimError, setDimError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  // Reset expansion when the underlying data changes (tab/quarter/entity switch)
  useEffect(() => { setExpandedLine(null); }, [data]);

  // Fetch dimensional detail when a line is expanded
  useEffect(() => {
    if (!expandedLine) { setDimData(null); return; }
    let cancelled = false;
    setDimLoading(true);
    setDimError(null);
    setDimData(null);
    fetchDimensionalDetail(expandedLine.id, entityId, period)
      .then((d) => { if (!cancelled) setDimData(d); })
      .catch((err) => { if (!cancelled) setDimError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setDimLoading(false); });
    return () => { cancelled = true; };
  }, [expandedLine?.id, entityId, period]);

  if (!data) return null;
  const denomLabel = unitLabel(data.metadata.unit);
  const totalCols = showVariance && pyData ? 5 : 2;
  const expansionBorder = `3px solid ${COLORS.accent}`;

  // Build fallback children for component breakdown (lines without dimensional triples)
  function getFallbackChildren(lineKey: string): { children: FinancialStatementLineItem[]; periods: string[]; parent: FinancialStatementLineItem | undefined } {
    if (!fsData) return { children: [], periods: [], parent: undefined };
    const lineItem = fsData.line_items.find((li) => li.key === lineKey);
    if (!lineItem) return { children: [], periods: [], parent: undefined };
    const idx = fsData.line_items.indexOf(lineItem);
    const periods = fsData.periods.filter((p) => !p.toLowerCase().includes('variance'));
    const kids: FinancialStatementLineItem[] = [];
    if (lineItem.is_subtotal) {
      for (let i = idx - 1; i >= 0; i--) {
        const li = fsData.line_items[i];
        if (li.is_subtotal || (li.indent === 0 && !li.key)) break;
        if (li.format !== 'percent') kids.unshift(li);
      }
    } else {
      for (let i = idx + 1; i < fsData.line_items.length; i++) {
        const li = fsData.line_items[i];
        if (li.indent <= lineItem.indent) break;
        if (li.format !== 'percent') kids.push(li);
      }
    }
    return { children: kids, periods, parent: lineItem };
  }

  function renderExpansionRows(lineId: string, lineName: string) {
    if (expandedLine?.id !== lineId) return null;
    const hasDimensions = dimData && dimData.dimensions.length > 0;

    // Loading
    if (dimLoading) {
      return (
        <tr key={`${lineId}-loading`} style={{ borderLeft: expansionBorder }}>
          <td colSpan={totalCols} style={{ padding: "12px 16px 12px 56px", fontSize: 13, color: COLORS.textMuted }}>
            Loading...
          </td>
        </tr>
      );
    }

    // Error
    if (dimError) {
      return (
        <tr key={`${lineId}-error`} style={{ borderLeft: expansionBorder }}>
          <td colSpan={totalCols} style={{ padding: "8px 16px 8px 56px" }}>
            <div style={{ padding: "8px 12px", background: COLORS.redBg, borderRadius: 4, fontSize: 13, color: COLORS.red }}>
              {dimError}
            </div>
          </td>
        </tr>
      );
    }

    // Dimensional data
    if (hasDimensions) {
      const section = dimData.dimensions[activeTab];
      const rows: React.ReactNode[] = [];

      // Tab bar (only if multiple dimensions)
      if (dimData.dimensions.length > 1) {
        rows.push(
          <tr key={`${lineId}-tabs`} style={{ borderLeft: expansionBorder, background: COLORS.highlight }}>
            <td colSpan={totalCols} style={{ padding: "6px 16px 6px 56px" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {dimData.dimensions.map((dim, idx) => (
                  <button key={dim.name} onClick={() => setActiveTab(idx)} style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "4px 12px", fontSize: 11, fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    fontFamily: "'JetBrains Mono',monospace",
                    color: idx === activeTab ? COLORS.accent : COLORS.textMuted,
                    borderBottom: idx === activeTab ? `2px solid ${COLORS.accent}` : "2px solid transparent",
                  }}>{dim.name}</button>
                ))}
              </div>
            </td>
          </tr>
        );
      }

      // Scrollable items
      rows.push(
        <tr key={`${lineId}-items`} style={{ borderLeft: expansionBorder }}>
          <td colSpan={totalCols} style={{ padding: 0 }}>
            <div style={{ maxHeight: 280, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: `${COLORS.borderLight} transparent` }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>
                <tbody>
                  {section.items.map((item) => (
                    <tr key={item.property} style={{ borderBottom: `1px solid ${COLORS.border}22`, borderLeft: expansionBorder }}>
                      <td style={{ padding: "6px 16px 6px 56px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 13, width: "40%" }}>{item.property}</td>
                      <td style={{ textAlign: "right", padding: "6px 16px", color: COLORS.text }}>{fmtFull(item.value)}</td>
                      <td style={{ textAlign: "right", padding: "6px 16px", color: COLORS.textMuted }}>{item.pct_of_total !== null ? item.pct_of_total.toFixed(1) + "%" : "\u2014"}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `1px solid ${COLORS.borderLight}`, borderLeft: expansionBorder, background: COLORS.totalBg }}>
                    <td style={{ padding: "6px 16px 6px 56px", fontWeight: 600, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 13 }}>Total</td>
                    <td style={{ textAlign: "right", padding: "6px 16px", fontWeight: 600, color: COLORS.text }}>{fmtFull(section.total)}</td>
                    <td style={{ textAlign: "right", padding: "6px 16px", fontWeight: 600, color: COLORS.textMuted }}>100.0%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      );

      return <>{rows}</>;
    }

    // Component breakdown fallback
    const { children, periods: fallbackPeriods, parent } = getFallbackChildren(lineId);
    if (children.length > 0 && parent) {
      return (
        <>
          <tr key={`${lineId}-label`} style={{ borderLeft: expansionBorder, background: COLORS.highlight }}>
            <td colSpan={totalCols} style={{ padding: "6px 16px 6px 56px", fontSize: 11, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
              Component Breakdown
            </td>
          </tr>
          <tr key={`${lineId}-breakdown`} style={{ borderLeft: expansionBorder }}>
            <td colSpan={totalCols} style={{ padding: 0 }}>
              <div style={{ maxHeight: 280, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: `${COLORS.borderLight} transparent` }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono',monospace", fontSize: 13 }}>
                  <tbody>
                    {children.map((child) => {
                      const parentVal = parent.values[fallbackPeriods[0]];
                      const childVal = child.values[fallbackPeriods[0]];
                      const pctOfTotal = parentVal && childVal ? (childVal / Math.abs(parentVal)) * 100 : null;
                      return (
                        <tr key={child.key} style={{ borderBottom: `1px solid ${COLORS.border}22`, borderLeft: expansionBorder }}>
                          <td style={{ padding: "6px 16px 6px 56px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 13, width: "40%" }}>{child.label}</td>
                          <td style={{ textAlign: "right", padding: "6px 16px", color: COLORS.text }}>{fmt(child.values[fallbackPeriods[0]])}</td>
                          <td style={{ textAlign: "right", padding: "6px 16px", color: COLORS.textMuted }}>{pctOfTotal !== null ? pctOfTotal.toFixed(1) + "%" : "\u2014"}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: `1px solid ${COLORS.borderLight}`, borderLeft: expansionBorder, background: COLORS.totalBg }}>
                      <td style={{ padding: "6px 16px 6px 56px", fontWeight: 600, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 13 }}>{lineName}</td>
                      <td style={{ textAlign: "right", padding: "6px 16px", fontWeight: 600, color: COLORS.text }}>{fmt(parent.values[fallbackPeriods[0]])}</td>
                      <td style={{ textAlign: "right", padding: "6px 16px", fontWeight: 600, color: COLORS.textMuted }}>100.0%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        </>
      );
    }

    // No breakdown available
    return (
      <tr key={`${lineId}-empty`} style={{ borderLeft: expansionBorder }}>
        <td colSpan={totalCols} style={{ padding: "10px 16px 10px 56px", fontSize: 13, color: COLORS.textMuted }}>
          No dimensional breakdown available for this line item.
        </td>
      </tr>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono','JetBrains Mono',monospace", fontSize: 15 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${COLORS.accent}` }}>
            <th style={{ textAlign: "left", padding: "10px 16px", color: COLORS.textMuted, fontWeight: 500, width: "40%", fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {denomLabel && <span style={{ fontWeight: 400, fontSize: 14, fontStyle: "italic", letterSpacing: "0.04em", color: COLORS.textDim }}>{denomLabel}</span>}
            </th>
            <th style={{ textAlign: "right", padding: "10px 16px", color: COLORS.textMuted, fontWeight: 500, fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {data.metadata.periodType === "forecast" ? "CF " : ""}{data.metadata.quarter}
            </th>
            {showVariance && pyData && (
              <>
                <th style={{ textAlign: "right", padding: "10px 16px", color: COLORS.textMuted, fontWeight: 500, fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase" }}>{pyData.metadata.quarter}</th>
                <th style={{ textAlign: "right", padding: "10px 16px", color: COLORS.textMuted, fontWeight: 500, fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase" }}>Var $</th>
                <th style={{ textAlign: "right", padding: "10px 16px", color: COLORS.textMuted, fontWeight: 500, fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase" }}>Var %</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, i) => {
            const pyLine = pyData?.lines?.[i];
            const varAmt = line.amount !== null && pyLine?.amount !== null && pyLine?.amount !== undefined ? line.amount - pyLine.amount : null;
            const isNeg = varAmt !== null && varAmt < 0;
            const isExpanded = expandedLine?.id === line.id;
            const rowBg = isExpanded ? COLORS.highlight : line.isTotal ? COLORS.totalBg : line.highlight ? COLORS.highlight : "transparent";
            const canDrill = line.drillable;
            return (
              <React.Fragment key={line.id}>
                <tr style={{
                  borderBottom: line.isFinal ? `2px double ${COLORS.accent}` : line.isTotal ? `1px solid ${COLORS.borderLight}` : `1px solid ${COLORS.border}22`,
                  borderLeft: isExpanded ? expansionBorder : "3px solid transparent",
                  background: rowBg,
                  cursor: canDrill ? "pointer" : "default",
                }}
                  onClick={() => {
                    if (!canDrill) return;
                    if (isExpanded) { setExpandedLine(null); }
                    else { setExpandedLine({ id: line.id, name: line.name }); setActiveTab(0); }
                  }}
                >
                  <td style={{
                    padding: line.isHeader ? "14px 16px 6px" : "8px 16px",
                    paddingLeft: line.level === 1 ? 40 : 16,
                    color: line.isHeader ? COLORS.accent : line.bold ? COLORS.text : line.isPercent ? COLORS.textMuted : COLORS.text,
                    fontWeight: line.bold || line.isHeader ? 600 : 400,
                    fontSize: line.isHeader ? 14 : 15,
                    letterSpacing: line.isHeader ? "0.06em" : "0",
                    textTransform: line.isHeader ? "uppercase" as const : "none" as const,
                    fontFamily: "'IBM Plex Sans',sans-serif",
                    cursor: canDrill ? "pointer" : "default",
                  }}>
                    {canDrill && <span style={{ color: COLORS.accent, marginRight: 6, fontSize: 14 }}>{isExpanded ? "\u25BE" : "\u25B8"}</span>}
                    {line.name}
                    {line.highlight && <span style={{ marginLeft: 8, fontSize: 14, color: COLORS.accent, background: "rgba(199,120,64,0.12)", padding: "2px 6px", borderRadius: 3 }}>SYNERGY</span>}
                  </td>
                  <td style={{ textAlign: "right", padding: "8px 16px", color: line.isPercent ? COLORS.textMuted : COLORS.text, fontWeight: line.bold ? 600 : 400 }}>
                    {line.isHeader ? "" : fmt(line.amount, line.isPercent)}
                    {data.metadata.periodType === "forecast" && !line.isHeader && !line.isPercent && (
                      <span style={{ marginLeft: 4, fontSize: 11, color: COLORS.textDim }}>CF</span>
                    )}
                  </td>
                  {showVariance && pyData && (
                    <>
                      <td style={{ textAlign: "right", padding: "8px 16px", color: COLORS.textMuted }}>
                        {line.isHeader ? "" : fmt(pyLine?.amount, line.isPercent)}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 16px", color: varAmt === null ? COLORS.textDim : isNeg ? COLORS.red : COLORS.green }}>
                        {line.isHeader || line.isPercent || varAmt === null ? "" : fmt(varAmt)}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 16px", color: varAmt === null ? COLORS.textDim : isNeg ? COLORS.red : COLORS.green }}>
                        {line.isHeader || line.isPercent || !pyLine?.amount ? "" : variancePct(line.amount!, pyLine.amount)}
                      </td>
                    </>
                  )}
                </tr>
                {renderExpansionRows(line.id, line.name)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


interface DealInfo {
  acquirer: { id: string; label: string } | null;
  target: { id: string; label: string } | null;
  combinedAvailable: boolean;
}

function DealSelector({ selected, onChange, onDealLoaded }: { selected: EntitySelection; onChange: (e: EntitySelection) => void; onDealLoaded?: (names: Record<string, string>) => void }) {
  const [deals, setDeals] = React.useState<{ value: string; label: string; deal: DealInfo }[]>([]);
  const [activeDeal, setActiveDeal] = React.useState<DealInfo | null>(null);
  const [dealError, setDealError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getEngagementContext()
      .then((ctx) => {
        // entity_a and entity_b come from the engagement config with id,
        // display_name, and role ("acquirer" or "target").
        const acqEntity = ctx.entity_a.role === "acquirer" ? ctx.entity_a : ctx.entity_b;
        const tgtEntity = ctx.entity_a.role === "target" ? ctx.entity_a : ctx.entity_b;
        const acquirer = { id: acqEntity.id, label: acqEntity.display_name };
        const target = { id: tgtEntity.id, label: tgtEntity.display_name };
        const deal: DealInfo = {
          acquirer,
          target,
          // Combined is always available in Convergence — that is the
          // purpose of the ME engagement.
          combinedAvailable: true,
        };
        const dealLabel = `${acquirer.label} / ${target.label}`;
        const dealValue = `${acquirer.id}_${target.id}`;
        setDeals([{ value: dealValue, label: dealLabel, deal }]);
        setActiveDeal(deal);
        setDealError(null);
        if (onDealLoaded) {
          const names: Record<string, string> = {
            combined: "Combined",
            [acquirer.id]: acquirer.label,
            [target.id]: target.label,
          };
          onDealLoaded(names);
        }
      })
      .catch((err) => {
        setDealError(err instanceof Error ? err.message : "Failed to load entities from engagement context");
      });
  }, []);

  if (dealError) {
    return (
      <div style={{ padding: "6px 12px", fontSize: 12, color: COLORS.red, fontFamily: "'IBM Plex Sans',sans-serif" }}>
        Entity discovery failed: {dealError}
      </div>
    );
  }

  if (!activeDeal) return null;

  const viewButtons: { key: string; label: string; entityId: string }[] = [];
  if (activeDeal.acquirer) {
    viewButtons.push({ key: "acquirer", label: "Acquiror", entityId: activeDeal.acquirer.id });
  }
  if (activeDeal.target) {
    viewButtons.push({ key: "target", label: "Target", entityId: activeDeal.target.id });
  }
  if (activeDeal.combinedAvailable) {
    viewButtons.push({ key: "combined", label: "Combined", entityId: "combined" });
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexShrink: 0 }}>
      {deals.length > 0 && (
        <Select
          label="Deal"
          value={deals[0].value}
          onChange={() => {}}
          options={deals.map((d) => ({ value: d.value, label: d.label }))}
          width={200}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 2, paddingBottom: 2 }}>
        {viewButtons.map((b) => {
          const isActive = selected === b.entityId;
          return (
            <button key={b.key} onClick={() => onChange(b.entityId)} style={{
              padding: "6px 14px", fontSize: 12, fontWeight: isActive ? 600 : 400,
              fontFamily: "'IBM Plex Sans',sans-serif", letterSpacing: "0.03em", cursor: "pointer",
              transition: "all 0.15s", borderRadius: 4,
              background: isActive ? COLORS.surface : "transparent",
              color: isActive ? COLORS.text : COLORS.textMuted,
              border: isActive
                ? `1px solid ${COLORS.borderLight}`
                : `1px solid transparent`,
              whiteSpace: "nowrap" as const,
            }}>
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// COMBINING STATEMENT (four-column layout)
// ============================================================

function fmtCombining(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return n < 0 ? `(${s})` : s;
}

function CombiningStatement({ data, loading, error, onRetry }: {
  data: CombiningStatementData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <LoadingState message="Loading combining statement..." />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!data) return null;

  const thStyle: React.CSSProperties = {
    textAlign: "right", padding: "10px 16px", color: COLORS.textMuted, fontWeight: 500,
    fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase",
    fontFamily: "'JetBrains Mono',monospace",
  };

  return (
    <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
      <div style={{ padding: "12px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>Combining Income Statement</span>
        <span style={{ fontSize: 14, color: COLORS.textMuted }}>{data.period}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono','JetBrains Mono',monospace", fontSize: 15 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${COLORS.accent}` }}>
              <th style={{ ...thStyle, textAlign: "left", width: "30%" }}>
                Line Item
                {" "}
                <span style={{ fontWeight: 400, fontSize: 14, fontStyle: "italic", letterSpacing: "0.04em", color: COLORS.textDim }}>($MM)</span>
              </th>
              <th style={thStyle}>Meridian</th>
              <th style={thStyle}>Cascadia</th>
              <th style={{ ...thStyle, background: "rgba(255,235,59,0.06)" }}>Adjustments</th>
              <th style={thStyle}>Combined</th>
            </tr>
          </thead>
          <tbody>
            {data.line_items.map((item, i) => {
              const isTotal = item.line_item.startsWith("Total");
              const isBold = isTotal || item.line_item.includes("Net Income") || item.line_item.includes("EBITDA");
              const numStyle = (val: number, isAdj = false): React.CSSProperties => ({
                textAlign: "right", padding: "8px 16px",
                fontWeight: isBold ? 600 : 400,
                color: val < 0 ? COLORS.red : COLORS.text,
                background: isAdj ? "rgba(255,235,59,0.04)" : "transparent",
              });
              return (
                <tr key={i} style={{
                  borderTop: isTotal ? `1px solid ${COLORS.borderLight}` : "none",
                  borderBottom: `1px solid ${COLORS.border}22`,
                  background: isBold ? COLORS.totalBg : "transparent",
                }}>
                  <td style={{
                    padding: "8px 16px", fontFamily: "'IBM Plex Sans',sans-serif",
                    fontWeight: isBold ? 600 : 400, color: COLORS.text,
                  }}>
                    {item.line_item}
                  </td>
                  <td style={numStyle(item.meridian)}>{fmtCombining(item.meridian)}</td>
                  <td style={numStyle(item.cascadia)}>{fmtCombining(item.cascadia)}</td>
                  <td style={numStyle(item.adjustments, true)}>{fmtCombining(item.adjustments)}</td>
                  <td style={numStyle(item.combined)}>{fmtCombining(item.combined)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Loading spinner (themed)
// ============================================================
function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 16, color: COLORS.textMuted, fontFamily: "'IBM Plex Sans',sans-serif" }}>{message}</div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div style={{ margin: "20px 0", padding: "20px", background: COLORS.redBg, borderRadius: 8, border: `1px solid ${COLORS.red}33` }}>
      <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.red, fontFamily: "'IBM Plex Sans',sans-serif", margin: 0 }}>Error loading report data</p>
      <p style={{ fontSize: 14, color: COLORS.red, fontFamily: "'IBM Plex Mono',monospace", margin: "8px 0 0", whiteSpace: "pre-wrap", opacity: 0.85 }}>{error}</p>
      <button onClick={onRetry} style={{ marginTop: 12, fontSize: 14, color: COLORS.red, background: "transparent", border: `1px solid ${COLORS.red}44`, padding: "4px 12px", borderRadius: 4, cursor: "pointer" }}>Retry</button>
    </div>
  );
}

// ============================================================
// OVERLAP TAB
// ============================================================

function OverlapTab() {
  const [data, setData] = useState<OverlapSummary | null>(null);
  const [entityA, setEntityA] = useState<{ id: string; name: string } | null>(null);
  const [entityB, setEntityB] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchOverlapSummary(), getEngagementContext()])
      .then(([summary, ctx]) => {
        setData(summary);
        setEntityA({ id: ctx.entity_a.id, name: ctx.entity_a.display_name });
        setEntityB({ id: ctx.entity_b.id, name: ctx.entity_b.display_name });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState message="Loading entity overlap..." />;
  if (error || !data || !entityA || !entityB) return <ErrorState error={error || "No data"} onRetry={load} />;

  const domains: { key: keyof OverlapSummary; label: string }[] = [
    { key: "customer", label: "Customers" },
    { key: "vendor", label: "Vendors" },
    { key: "employee", label: "Employees" },
  ];

  const thS: React.CSSProperties = { textAlign: "left", padding: "8px 12px", color: COLORS.textMuted, fontWeight: 500, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" };
  const thR: React.CSSProperties = { ...thS, textAlign: "right" };

  return (
    <div>
      {/* Top KPI cards — overlap counts per domain */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        {domains.map(({ key, label }) => {
          const d = data[key];
          return (
            <div key={key} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "16px 20px", flex: "1 1 220px", minWidth: 220 }}>
              <div style={{ fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>{label}</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: COLORS.accent, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>
                {d.overlap_count.toLocaleString()}
              </div>
              <div style={{ fontSize: 14, color: COLORS.textDim, marginTop: 2 }}>shared across both entities</div>
            </div>
          );
        })}
      </div>

      {/* Detail table — per-domain breakdown */}
      <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 16, fontWeight: 600, color: COLORS.text }}>
          Overlap Breakdown
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono','JetBrains Mono',monospace", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${COLORS.accent}` }}>
              <th style={thS}>Domain</th>
              <th style={thR}>{entityA.name} Total</th>
              <th style={thR}>{entityB.name} Total</th>
              <th style={thR}>Overlap</th>
              <th style={thR}>% of {entityA.name}</th>
              <th style={thR}>% of {entityB.name}</th>
            </tr>
          </thead>
          <tbody>
            {domains.map(({ key, label }) => {
              const d = data[key];
              return (
                <tr key={key} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                  <td style={{ padding: "8px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>{label}</td>
                  <td style={{ textAlign: "right", padding: "8px 12px", color: COLORS.textMuted }}>{d.entity_a_total.toLocaleString()}</td>
                  <td style={{ textAlign: "right", padding: "8px 12px", color: COLORS.textMuted }}>{d.entity_b_total.toLocaleString()}</td>
                  <td style={{ textAlign: "right", padding: "8px 12px", color: COLORS.accent, fontWeight: 700 }}>{d.overlap_count.toLocaleString()}</td>
                  <td style={{ textAlign: "right", padding: "8px 12px", color: COLORS.text }}>{d.overlap_pct_a.toFixed(1)}%</td>
                  <td style={{ textAlign: "right", padding: "8px 12px", color: COLORS.text }}>{d.overlap_pct_b.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// CROSS-SELL TAB
// ============================================================

function CrossSellTab() {
  const [data, setData] = useState<CrossSellData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"m_to_c" | "c_to_m">("m_to_c");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchCrossSell()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading cross-sell pipeline..." />;
  if (error || !data) return <ErrorState error={error || "No data"} onRetry={() => { setLoading(true); setError(null); fetchCrossSell().then(setData).catch((e) => setError(String(e))).finally(() => setLoading(false)); }} />;

  const s = data.summary;
  const candidates = direction === "m_to_c" ? data.m_to_c : data.c_to_m;
  const dirCount = direction === "m_to_c" ? s.m_to_c_candidates : s.c_to_m_candidates;
  const dirAcv = direction === "m_to_c" ? s.m_to_c_total_acv : s.c_to_m_total_acv;
  const dirHighCount = direction === "m_to_c" ? s.m_to_c_high_conf_count : s.c_to_m_high_conf_count;
  const dirHighAcv = direction === "m_to_c" ? s.m_to_c_high_conf_acv : s.c_to_m_high_conf_acv;
  const thS: React.CSSProperties = { textAlign: "left", padding: "8px 12px", color: COLORS.textMuted, fontWeight: 500, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" };
  const thR: React.CSSProperties = { ...thS, textAlign: "right" };

  return (
    <div>
      {/* Summary cards — first two filter by active direction, last two show combined */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { label: "Pipeline", value: fmtDollar(dirAcv), sub: `${dirCount} candidates` },
          { label: "High Confidence", value: fmtDollar(dirHighAcv), sub: `${dirHighCount} candidates` },
          { label: "Combined Pipeline", value: fmtDollar(s.total_pipeline_acv), sub: `${s.total_candidates} total` },
          { label: "Combined High Conf", value: fmtDollar(s.total_high_conf_acv), sub: "Score \u2265 80" },
        ].map((card) => (
          <div key={card.label} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "16px 20px", flex: "1 1 180px", minWidth: 180 }}>
            <div style={{ fontSize: 15, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>{card.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{card.value}</div>
            <div style={{ fontSize: 14, color: COLORS.textDim, marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Direction toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["m_to_c", "c_to_m"] as const).map((d) => (
          <button key={d} onClick={() => setDirection(d)} style={{
            padding: "6px 16px", fontSize: 14, fontWeight: direction === d ? 600 : 400,
            background: direction === d ? "rgba(199,120,64,0.12)" : "transparent",
            color: direction === d ? COLORS.accent : COLORS.textMuted,
            border: `1px solid ${direction === d ? COLORS.accent + "44" : COLORS.border}`,
            borderRadius: 4, cursor: "pointer", fontFamily: "'IBM Plex Sans',sans-serif",
          }}>
            {d === "m_to_c" ? "Meridian Advisory \u2192 Cascadia Clients" : "Cascadia BPM \u2192 Meridian Clients"}
          </button>
        ))}
      </div>

      {/* Pipeline table */}
      <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono','JetBrains Mono',monospace", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${COLORS.accent}` }}>
              <th style={thS}>Customer</th>
              <th style={thS}>Recommended Service</th>
              <th style={thR}>Score</th>
              <th style={thR}>Est. ACV</th>
              <th style={thS}>Industry</th>
              <th style={thS}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "32px 16px", textAlign: "center", color: COLORS.textMuted, fontSize: 15, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                  No cross-sell opportunities found. Customer and service data may not be ingested yet.
                </td>
              </tr>
            )}
            {candidates.map((c) => {
              const isExp = expanded === c.customer_id;
              return (
                <React.Fragment key={c.customer_id}>
                  <tr onClick={() => setExpanded(isExp ? null : c.customer_id)} style={{
                    borderBottom: `1px solid ${COLORS.border}22`, cursor: "pointer",
                    background: isExp ? COLORS.surfaceHover : "transparent",
                  }}>
                    <td style={{ padding: "8px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                      <span style={{ color: COLORS.accent, marginRight: 6, fontSize: 14 }}>{isExp ? "\u25BE" : "\u25B8"}</span>
                      {c.customer_name}
                    </td>
                    <td style={{ padding: "8px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>{c.recommended_service}</td>
                    <td style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600, color: c.propensity_score >= 80 ? COLORS.green : c.propensity_score >= 60 ? COLORS.accent : COLORS.textMuted }}>
                      {c.propensity_score}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px 12px", color: COLORS.text }}>{fmtDollar(c.estimated_acv)}</td>
                    <td style={{ padding: "8px 12px", color: COLORS.textMuted, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 15 }}>{c.industry}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 3, fontWeight: 600,
                        background: c.propensity_score >= 80 ? COLORS.greenBg : c.propensity_score >= 60 ? "rgba(199,120,64,0.08)" : COLORS.redBg,
                        color: c.propensity_score >= 80 ? COLORS.green : c.propensity_score >= 60 ? COLORS.accent : COLORS.red,
                      }}>{fmtScore(c.propensity_score)}</span>
                    </td>
                  </tr>
                  {isExp && (
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td colSpan={6} style={{ padding: "12px 20px 16px", background: COLORS.surface }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 14, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                          <div><span style={{ color: COLORS.textDim }}>Buyer Persona:</span> <span style={{ color: COLORS.text }}>{c.buyer_persona}</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Years as Client:</span> <span style={{ color: COLORS.text }}>{c.years_as_client}</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Industry Match:</span> <span style={{ color: COLORS.text }}>{c.industry_match}/25</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Size Match:</span> <span style={{ color: COLORS.text }}>{c.size_match}/20</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Behavioral:</span> <span style={{ color: COLORS.text }}>{c.behavioral_score}/30</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Engagement Fit:</span> <span style={{ color: COLORS.text }}>{c.engagement_fit}/15</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Relationship:</span> <span style={{ color: COLORS.text }}>{c.relationship_strength}/10</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Current Engagement:</span> <span style={{ color: COLORS.text }}>{fmtDollar(c.customer_engagement_M)}</span></div>
                        </div>
                        <div style={{ marginTop: 12, padding: "10px 14px", background: COLORS.bg, borderRadius: 6, fontSize: 14, color: COLORS.textMuted, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 600, color: COLORS.text }}>Rationale:</span> {c.rationale}
                        </div>
                        {c.comparable_customers.length > 0 && (
                          <div style={{ marginTop: 8, fontSize: 15, color: COLORS.textDim }}>
                            <span style={{ fontWeight: 600 }}>Comparable:</span> {c.comparable_customers.join(", ")}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// UPSELL TAB
// ============================================================

function UpsellTab() {
  const [data, setData] = useState<UpsellData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"m_to_c" | "c_to_m">("m_to_c");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchUpsell()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading upsell opportunities..." />;
  if (error || !data) return <ErrorState error={error || "No data"} onRetry={() => { setLoading(true); setError(null); fetchUpsell().then(setData).catch((e) => setError(String(e))).finally(() => setLoading(false)); }} />;

  const s = data.summary;
  const candidates = direction === "m_to_c" ? data.m_to_c : data.c_to_m;
  const dirCount = direction === "m_to_c" ? s.m_to_c_count : s.c_to_m_count;
  const dirAcv = direction === "m_to_c" ? s.m_to_c_acv : s.c_to_m_acv;
  const thS: React.CSSProperties = { textAlign: "left", padding: "8px 12px", color: COLORS.textMuted, fontWeight: 500, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" };
  const thR: React.CSSProperties = { ...thS, textAlign: "right" };

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { label: "Shared Customers", value: String(s.total_shared_customers), sub: "served by both entities" },
          { label: "Opportunities", value: String(dirCount), sub: `${direction === "m_to_c" ? "M\u2192C" : "C\u2192M"} direction` },
          { label: "Expansion ACV", value: fmtDollar(dirAcv), sub: `${dirCount} gap services` },
          { label: "Avg Score", value: String(s.avg_score), sub: "across all opportunities" },
        ].map((card) => (
          <div key={card.label} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "16px 20px", flex: "1 1 180px", minWidth: 180 }}>
            <div style={{ fontSize: 15, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>{card.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{card.value}</div>
            <div style={{ fontSize: 14, color: COLORS.textDim, marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Direction toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["m_to_c", "c_to_m"] as const).map((d) => (
          <button key={d} onClick={() => setDirection(d)} style={{
            padding: "6px 16px", fontSize: 14, fontWeight: direction === d ? 600 : 400,
            background: direction === d ? "rgba(199,120,64,0.12)" : "transparent",
            color: direction === d ? COLORS.accent : COLORS.textMuted,
            border: `1px solid ${direction === d ? COLORS.accent + "44" : COLORS.border}`,
            borderRadius: 4, cursor: "pointer", fontFamily: "'IBM Plex Sans',sans-serif",
          }}>
            {d === "m_to_c" ? "Meridian Services \u2192 Cascadia Clients" : "Cascadia Services \u2192 Meridian Clients"}
          </button>
        ))}
      </div>

      {/* Upsell table */}
      <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono','JetBrains Mono',monospace", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${COLORS.accent}` }}>
              <th style={thS}>Customer</th>
              <th style={thS}>Gap Service</th>
              <th style={thR}>Score</th>
              <th style={thR}>Est. ACV</th>
              <th style={thS}>Current Services</th>
              <th style={thS}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "32px 16px", textAlign: "center", color: COLORS.textMuted, fontSize: 15, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                  No upsell opportunities found. Customer and service data may not be ingested yet.
                </td>
              </tr>
            )}
            {candidates.map((c, idx) => {
              const rowKey = `${c.customer_id}-${c.gap_service}-${idx}`;
              const isExp = expanded === rowKey;
              return (
                <React.Fragment key={rowKey}>
                  <tr onClick={() => setExpanded(isExp ? null : rowKey)} style={{
                    borderBottom: `1px solid ${COLORS.border}22`, cursor: "pointer",
                    background: isExp ? COLORS.surfaceHover : "transparent",
                  }}>
                    <td style={{ padding: "8px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                      <span style={{ color: COLORS.accent, marginRight: 6, fontSize: 14 }}>{isExp ? "\u25BE" : "\u25B8"}</span>
                      {c.customer_name}
                    </td>
                    <td style={{ padding: "8px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>{c.gap_service_name}</td>
                    <td style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600, color: c.upsell_score >= 80 ? COLORS.green : c.upsell_score >= 60 ? COLORS.accent : COLORS.textMuted }}>
                      {c.upsell_score}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px 12px", color: COLORS.text }}>{fmtDollar(c.typical_acv)}</td>
                    <td style={{ padding: "8px 12px", color: COLORS.textMuted, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 13 }}>
                      {c.current_services.map(s => s.replace(/_/g, " ")).join(", ")}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 3, fontWeight: 600,
                        background: c.upsell_score >= 80 ? COLORS.greenBg : c.upsell_score >= 60 ? "rgba(199,120,64,0.08)" : COLORS.redBg,
                        color: c.upsell_score >= 80 ? COLORS.green : c.upsell_score >= 60 ? COLORS.accent : COLORS.red,
                      }}>{fmtScore(c.upsell_score)}</span>
                    </td>
                  </tr>
                  {isExp && (
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td colSpan={6} style={{ padding: "12px 20px 16px", background: COLORS.surface }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 14, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                          <div><span style={{ color: COLORS.textDim }}>Satisfaction:</span> <span style={{ color: COLORS.text }}>{c.satisfaction_score}/100</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Contract Type:</span> <span style={{ color: COLORS.text }}>{c.contract_type}</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Relationship Strength:</span> <span style={{ color: COLORS.text }}>{c.relationship_strength}/30</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Service Adjacency:</span> <span style={{ color: COLORS.text }}>{c.service_adjacency}/25</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Revenue Potential:</span> <span style={{ color: COLORS.text }}>{c.revenue_potential}/25</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Contract Recency:</span> <span style={{ color: COLORS.text }}>{c.contract_recency}/20</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Start Year:</span> <span style={{ color: COLORS.text }}>{c.engagement_start_year}</span></div>
                          <div><span style={{ color: COLORS.textDim }}>Current Engagement:</span> <span style={{ color: COLORS.text }}>{fmtDollar(c.current_engagement_revenue_M)}</span></div>
                        </div>
                        <div style={{ marginTop: 12, padding: "10px 14px", background: COLORS.bg, borderRadius: 6, fontSize: 14, color: COLORS.textMuted, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 600, color: COLORS.text }}>Rationale:</span> {c.rationale}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// REVENUE BY CUSTOMER TAB
// ============================================================

function RevenueByCustomerTab({ entityId }: { entityId: string }) {
  const [data, setData] = useState<RevenueByCustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchRevenueByCustomer(entityId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [entityId]);

  if (loading) return <LoadingState message="Loading revenue by customer..." />;
  if (error || !data) return <ErrorState error={error || "No data"} onRetry={() => { setLoading(true); setError(null); fetchRevenueByCustomer(entityId).then(setData).catch((e) => setError(String(e))).finally(() => setLoading(false)); }} />;

  const thS: React.CSSProperties = { textAlign: "left", padding: "8px 12px", color: COLORS.textMuted, fontWeight: 500, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" };
  const thR: React.CSSProperties = { ...thS, textAlign: "right" };
  const tdR: React.CSSProperties = { textAlign: "right", padding: "8px 12px", fontFamily: "'IBM Plex Mono',monospace", fontSize: 14 };

  const top20 = data.customers.slice(0, 20);
  const top20Total = top20.reduce((s, c) => s + c.total, 0);
  const coverageRatio = data.total_revenue > 0 ? (top20Total / data.total_revenue * 100) : 0;

  // Format quarter label: "2024-Q1" -> "Q1 '24"
  const fmtQ = (q: string) => {
    const [y, qn] = q.split("-");
    return `${qn} '${y.slice(2)}`;
  };

  const provMode = data.provenance?.mode?.toLowerCase();
  const isVerified = provMode === "ingest" || provMode === "live";

  return (
    <div>
      {/* Summary row */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { label: "Total Revenue", value: `$${data.total_revenue.toFixed(1)}M` },
          { label: "Customers", value: String(data.customer_count) },
          { label: "Top 20 Coverage", value: `${coverageRatio.toFixed(1)}%`, sub: `$${top20Total.toFixed(1)}M of $${data.total_revenue.toFixed(1)}M` },
          { label: "Data Source", value: isVerified ? "Verified" : data.provenance?.mode || "Unknown", sub: data.provenance?.pipeline_run_id ? `Run: ${data.provenance.pipeline_run_id.slice(0, 20)}...` : undefined },
        ].map((card) => (
          <div key={card.label} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "16px 20px", flex: "1 1 180px", minWidth: 180 }}>
            <div style={{ fontSize: 15, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>{card.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{card.value}</div>
            {card.sub && <div style={{ fontSize: 14, color: COLORS.textDim, marginTop: 2 }}>{card.sub}</div>}
          </div>
        ))}
      </div>

      {/* Quarterly revenue table */}
      <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'IBM Plex Mono','JetBrains Mono',monospace", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${COLORS.accent}` }}>
              <th style={thS}>Customer</th>
              {data.quarters.map((q) => <th key={q} style={thR}>{fmtQ(q)}</th>)}
              <th style={{ ...thR, fontWeight: 700 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {top20.map((c) => (
              <tr key={c.name} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                <td style={{ padding: "8px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>{c.name}</td>
                {data.quarters.map((q) => {
                  const v = c[q] as number;
                  return <td key={q} style={{ ...tdR, color: v > 0 ? COLORS.text : COLORS.textDim }}>{v > 0 ? v.toFixed(2) : "\u2014"}</td>;
                })}
                <td style={{ ...tdR, fontWeight: 600, color: COLORS.text }}>{c.total.toFixed(2)}</td>
              </tr>
            ))}
            {/* Reconciliation row */}
            <tr style={{ borderTop: `2px solid ${COLORS.accent}`, background: COLORS.surfaceHover }}>
              <td style={{ padding: "8px 12px", fontWeight: 700, color: COLORS.accent, fontFamily: "'IBM Plex Sans',sans-serif" }}>Top 20 Subtotal</td>
              {data.quarters.map((q) => {
                const qTotal = top20.reduce((s, c) => s + ((c[q] as number) || 0), 0);
                return <td key={q} style={{ ...tdR, fontWeight: 600, color: COLORS.accent }}>{qTotal.toFixed(2)}</td>;
              })}
              <td style={{ ...tdR, fontWeight: 700, color: COLORS.accent }}>{top20Total.toFixed(2)}</td>
            </tr>
            <tr style={{ background: COLORS.surfaceHover }}>
              <td style={{ padding: "8px 12px", fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>Total Revenue</td>
              {data.quarters.map((q) => {
                const qTotal = data.customers.reduce((s, c) => s + ((c[q] as number) || 0), 0);
                return <td key={q} style={{ ...tdR, fontWeight: 600, color: COLORS.text }}>{qTotal.toFixed(2)}</td>;
              })}
              <td style={{ ...tdR, fontWeight: 700, color: COLORS.text }}>{data.total_revenue.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* AR by Customer note */}
      <div style={{ marginTop: 16, padding: "12px 16px", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, color: COLORS.textMuted }}>
        <strong>Note:</strong> AR by Customer data is not available. Farm does not generate accounts receivable at customer granularity.
      </div>
    </div>
  );
}

// ============================================================
// EBITDA BRIDGE TAB
// ============================================================

function EBITDABridgeTab() {
  const [data, setData] = useState<EBITDABridgeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAdj, setExpandedAdj] = useState<string | null>(null);
  const [expandedKpi, setExpandedKpi] = useState<string | null>(null);

  useEffect(() => {
    fetchEBITDABridge()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading EBITDA bridge..." />;
  if (error || !data) return <ErrorState error={error || "No data"} onRetry={() => { setLoading(true); setError(null); fetchEBITDABridge().then(setData).catch((e) => setError(String(e))).finally(() => setLoading(false)); }} />;

  const rep = data.reported_ebitda;
  const ea = data.entity_adjusted_ebitda;
  const pf = data.pro_forma_ebitda;
  const ev = data.ev_impact;

  function BridgeLine({ adj, isSubtract }: { adj: BridgeAdjustment; isSubtract?: boolean }) {
    const isExp = expandedAdj === adj.name;
    return (
      <>
        <tr onClick={() => setExpandedAdj(isExp ? null : adj.name)} style={{ cursor: "pointer", borderBottom: `1px solid ${COLORS.border}22`, background: isExp ? COLORS.surfaceHover : "transparent" }}>
          <td style={{ padding: "8px 16px 8px 32px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif", fontSize: 15 }}>
            <span style={{ color: COLORS.accent, marginRight: 6, fontSize: 14 }}>{isExp ? "\u25BE" : "\u25B8"}</span>
            {isSubtract ? "\u2212 " : "+ "}{adj.name}
          </td>
          <td style={{ textAlign: "right", padding: "8px 16px", color: isSubtract ? COLORS.red : COLORS.green, fontSize: 15, fontFamily: "'IBM Plex Mono',monospace" }}>
            {isSubtract ? `(${fmtDollar(Math.abs(adj.amount))})` : fmtDollar(adj.amount)}
          </td>
          <td style={{ textAlign: "center", padding: "8px 12px" }}>
            <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 3, fontWeight: 600, color: confidenceColor(adj.confidence), background: adj.confidence === "high" ? COLORS.greenBg : adj.confidence === "medium" ? "rgba(199,120,64,0.08)" : COLORS.redBg }}>
              {adj.confidence.toUpperCase()}
            </span>
          </td>
        </tr>
        {isExp && (
          <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
            <td colSpan={3} style={{ padding: "8px 20px 12px 48px", background: COLORS.surface }}>
              <div style={{ fontSize: 14, color: COLORS.textMuted, lineHeight: 1.5, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                <div><span style={{ color: COLORS.textDim }}>Range:</span> {fmtDollar(adj.amount_low)} — {fmtDollar(adj.amount_high)}</div>
                <div><span style={{ color: COLORS.textDim }}>Category:</span> {adj.category.replace(/_/g, " ")}</div>
                {adj.lever && <div><span style={{ color: COLORS.textDim }}>Lever:</span> {adj.lever}</div>}
                <div style={{ marginTop: 6 }}><span style={{ color: COLORS.textDim }}>Support:</span> {adj.support_reference}</div>
                <div style={{ marginTop: 4 }}>{adj.rationale}</div>
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  const bridgeThS: React.CSSProperties = { textAlign: "left", padding: "8px 16px", color: COLORS.textMuted, fontWeight: 500, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" };

  return (
    <div>
      {/* Summary KPIs — drillable */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {([
            { id: "reported", label: "Reported EBITDA", value: fmtDollar(rep.combined_reported) },
            { id: "adjusted", label: "Entity Adjusted", value: fmtDollar(ea.combined) },
            { id: "pf_yr1", label: "Pro Forma Yr 1", value: fmtDollar(pf.year_1.current) },
            { id: "pf_ss", label: "Pro Forma Steady State", value: fmtDollar(pf.steady_state.current) },
            { id: "ev", label: `EV @ ${ev.multiple}x`, value: fmtDollar(ev.steady_state_ev.current) },
          ] as const).map((kpi) => {
            const isExp = expandedKpi === kpi.id;
            return (
              <div key={kpi.id} onClick={() => setExpandedKpi(isExp ? null : kpi.id)} style={{ background: isExp ? COLORS.surfaceHover : COLORS.surface, border: `1px solid ${isExp ? COLORS.accent : COLORS.border}`, borderRadius: 8, padding: "14px 18px", flex: "1 1 160px", cursor: "pointer", transition: "border-color 0.15s" }}>
                <div style={{ fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>
                  <span style={{ color: COLORS.accent, marginRight: 4, fontSize: 10 }}>{isExp ? "\u25BE" : "\u25B8"}</span>
                  {kpi.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{kpi.value}</div>
              </div>
            );
          })}
        </div>

        {/* KPI drill-through panel */}
        {expandedKpi && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.accent}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 20px", marginTop: -1 }}>
            {expandedKpi === "reported" && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Reported EBITDA by Entity</div>
                <table style={{ width: "100%", maxWidth: 400, borderCollapse: "collapse", fontSize: 14 }}>
                  <tbody>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "6px 0", color: COLORS.textMuted }}>Meridian</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: COLORS.text, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(rep.meridian)}</td>
                    </tr>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "6px 0", color: COLORS.textMuted }}>Cascadia</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: COLORS.text, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(rep.cascadia)}</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                      <td style={{ padding: "6px 0", color: COLORS.text, fontWeight: 700 }}>Combined</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: COLORS.text, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(rep.combined_reported)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {expandedKpi === "adjusted" && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Entity-Adjusted EBITDA</div>
                <table style={{ width: "100%", maxWidth: 500, borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <th style={{ textAlign: "left", padding: "4px 0", color: COLORS.textDim, fontSize: 14 }}></th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: COLORS.textDim, fontSize: 14 }}>MERIDIAN</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: COLORS.textDim, fontSize: 14 }}>CASCADIA</th>
                      <th style={{ textAlign: "right", padding: "4px 0", color: COLORS.textDim, fontSize: 14 }}>COMBINED</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "6px 0", color: COLORS.textMuted }}>Reported</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(rep.meridian)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(rep.cascadia)}</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(rep.combined_reported)}</td>
                    </tr>
                    {data.entity_adjustments.map((adj) => (
                      <tr key={adj.name} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                        <td style={{ padding: "6px 0", color: COLORS.textMuted, fontSize: 15 }}>{adj.name}</td>
                        <td colSpan={2} style={{ textAlign: "center", padding: "6px 8px", color: COLORS.textDim, fontSize: 14 }}>{adj.entity}</td>
                        <td style={{ textAlign: "right", padding: "6px 0", color: adj.amount >= 0 ? COLORS.green : COLORS.red, fontFamily: "'IBM Plex Mono',monospace" }}>{adj.amount >= 0 ? "+" : ""}{fmtDollar(adj.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                      <td style={{ padding: "6px 0", color: COLORS.text, fontWeight: 700 }}>Adjusted</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.text, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ea.meridian)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.text, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ea.cascadia)}</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: COLORS.text, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ea.combined)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {expandedKpi === "pf_yr1" && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pro Forma Year 1 — Range</div>
                <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, color: COLORS.textDim }}>LOW</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.red, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.year_1.low)}</div>
                  </div>
                  <div style={{ flex: 1, height: 6, background: COLORS.bg, borderRadius: 3, position: "relative", maxWidth: 200 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${COLORS.red}, ${COLORS.green})`, width: "100%" }} />
                    <div style={{ position: "absolute", top: -4, height: 14, width: 3, background: COLORS.accent, borderRadius: 1, left: `${pf.year_1.high === pf.year_1.low ? 50 : ((pf.year_1.current - pf.year_1.low) / (pf.year_1.high - pf.year_1.low)) * 100}%` }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: COLORS.textDim }}>HIGH</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.year_1.high)}</div>
                  </div>
                  <div style={{ borderLeft: `1px solid ${COLORS.border}`, paddingLeft: 24 }}>
                    <div style={{ fontSize: 14, color: COLORS.textDim }}>CURRENT</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.year_1.current)}</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, fontSize: 15, color: COLORS.textMuted }}>
                  Synergies applied: {data.combination_synergies.length} items totaling {fmtDollar(data.combination_synergies.reduce((s, a) => s + a.amount, 0))}
                </div>
              </div>
            )}
            {expandedKpi === "pf_ss" && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pro Forma Steady State — Range</div>
                <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, color: COLORS.textDim }}>LOW</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.red, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.steady_state.low)}</div>
                  </div>
                  <div style={{ flex: 1, height: 6, background: COLORS.bg, borderRadius: 3, position: "relative", maxWidth: 200 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${COLORS.red}, ${COLORS.green})`, width: "100%" }} />
                    <div style={{ position: "absolute", top: -4, height: 14, width: 3, background: COLORS.accent, borderRadius: 1, left: `${pf.steady_state.high === pf.steady_state.low ? 50 : ((pf.steady_state.current - pf.steady_state.low) / (pf.steady_state.high - pf.steady_state.low)) * 100}%` }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: COLORS.textDim }}>HIGH</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.steady_state.high)}</div>
                  </div>
                  <div style={{ borderLeft: `1px solid ${COLORS.border}`, paddingLeft: 24 }}>
                    <div style={{ fontSize: 14, color: COLORS.textDim }}>CURRENT</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.steady_state.current)}</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, fontSize: 15, color: COLORS.textMuted }}>
                  Full synergy realization assumed at steady state
                </div>
              </div>
            )}
            {expandedKpi === "ev" && (
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Enterprise Value Impact @ {ev.multiple}x Multiple</div>
                <table style={{ width: "100%", maxWidth: 500, borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <th style={{ textAlign: "left", padding: "4px 0", color: COLORS.textDim, fontSize: 14 }}></th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: COLORS.textDim, fontSize: 14 }}>LOW</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", color: COLORS.textDim, fontSize: 14 }}>CURRENT</th>
                      <th style={{ textAlign: "right", padding: "4px 0", color: COLORS.textDim, fontSize: 14 }}>HIGH</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "6px 0", color: COLORS.textMuted }}>Year 1 EV</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.red, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ev.year_1_ev.low)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.text, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ev.year_1_ev.current)}</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ev.year_1_ev.high)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6px 0", color: COLORS.text, fontWeight: 600 }}>Steady State EV</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.red, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ev.steady_state_ev.low)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", color: COLORS.text, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ev.steady_state_ev.current)}</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ev.steady_state_ev.high)}</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ marginTop: 10, fontSize: 15, color: COLORS.textMuted }}>
                  EV delta from reported: {fmtDollar(ev.steady_state_ev.current - rep.combined_reported * ev.multiple)} incremental value created
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* EBITDA Waterfall Chart */}
      {(() => {
        const waterfallBars: { label: string; base: number; value: number; rawValue: number; type: string }[] = [];
        let running = rep.combined_reported;
        waterfallBars.push({ label: "Reported EBITDA", base: 0, value: running, rawValue: running, type: "total" });
        for (const adj of data.entity_adjustments) {
          if (adj.amount >= 0) {
            waterfallBars.push({ label: adj.name, base: running, value: adj.amount, rawValue: adj.amount, type: "increase" });
          } else {
            waterfallBars.push({ label: adj.name, base: running + adj.amount, value: Math.abs(adj.amount), rawValue: adj.amount, type: "decrease" });
          }
          running += adj.amount;
        }
        waterfallBars.push({ label: "Entity Adjusted", base: 0, value: ea.combined, rawValue: ea.combined, type: "total" });
        running = ea.combined;
        for (const syn of data.combination_synergies) {
          if (syn.amount >= 0) {
            waterfallBars.push({ label: syn.name, base: running, value: syn.amount, rawValue: syn.amount, type: "increase" });
          } else {
            waterfallBars.push({ label: syn.name, base: running + syn.amount, value: Math.abs(syn.amount), rawValue: syn.amount, type: "decrease" });
          }
          running += syn.amount;
        }
        waterfallBars.push({ label: "Pro Forma Yr 1", base: 0, value: pf.year_1.current, rawValue: pf.year_1.current, type: "total" });
        return (
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "20px", marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>EBITDA Waterfall</div>
            <div style={{ width: "100%", height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterfallBars} margin={{ top: 30, right: 20, left: 20, bottom: 90 }} barCategoryGap="10%">
                  <XAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: COLORS.textMuted, angle: -40, textAnchor: "end" } as Record<string, unknown>} axisLine={{ stroke: COLORS.border }} tickLine={false} interval={0} height={90} />
                  <YAxis type="number" domain={[0, "auto"]} tickFormatter={(v: number) => { if (v === 0) return "$0"; const absM = Math.abs(v); return absM >= 1000 ? `$${(absM / 1000).toFixed(1)}B` : `$${absM.toFixed(0)}M`; }} tick={{ fontSize: 11, fill: COLORS.textDim }} axisLine={false} tickLine={false} />
                  <Bar dataKey="base" stackId="stack" fill="transparent" isAnimationActive={false} />
                  <Bar dataKey="value" stackId="stack" radius={[4, 4, 0, 0]} isAnimationActive={false}
                    label={({ x, y, width: w, index }: any) => {
                      const bar = waterfallBars[index];
                      if (!bar) return null;
                      return (
                        <text x={x + w / 2} y={y - 8} textAnchor="middle" fill={bar.type === "total" ? COLORS.text : bar.rawValue >= 0 ? COLORS.green : COLORS.red} fontSize={12} fontWeight={bar.type === "total" ? 600 : 400} fontFamily="'IBM Plex Mono',monospace">
                          {fmtDollar(bar.rawValue)}
                        </text>
                      );
                    }}
                  >
                    {waterfallBars.map((bar, index) => (
                      <Cell key={index} fill={bar.type === "total" ? COLORS.accent : bar.rawValue >= 0 ? COLORS.green : COLORS.red} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Bridge waterfall table */}
      <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${COLORS.accent}` }}>
              <th style={bridgeThS}>Proforma EBITDA</th>
              <th style={{ ...bridgeThS, textAlign: "right" }}>Amount</th>
              <th style={{ ...bridgeThS, textAlign: "center" }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {/* Reported */}
            <tr style={{ background: COLORS.totalBg, borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: "10px 16px", fontWeight: 600, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>Reported EBITDA (Combined)</td>
              <td style={{ textAlign: "right", padding: "10px 16px", fontWeight: 600, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(rep.combined_reported)}</td>
              <td></td>
            </tr>

            {/* Entity adjustments header */}
            <tr><td colSpan={3} style={{ padding: "12px 16px 4px", fontSize: 15, fontWeight: 600, color: COLORS.accent, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Entity-Level Adjustments</td></tr>
            {data.entity_adjustments.map((adj) => <BridgeLine key={adj.name} adj={adj} />)}

            {/* Entity adjusted subtotal */}
            <tr style={{ background: COLORS.totalBg, borderTop: `1px solid ${COLORS.borderLight}`, borderBottom: `1px solid ${COLORS.borderLight}` }}>
              <td style={{ padding: "10px 16px", fontWeight: 600, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>Entity-Level Adjusted EBITDA</td>
              <td style={{ textAlign: "right", padding: "10px 16px", fontWeight: 600, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(ea.combined)}</td>
              <td></td>
            </tr>

            {/* Combination synergies header */}
            <tr><td colSpan={3} style={{ padding: "12px 16px 4px", fontSize: 15, fontWeight: 600, color: COLORS.accent, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Combination Synergies</td></tr>
            {data.combination_synergies.map((syn) => (
              <BridgeLine key={syn.name} adj={syn} isSubtract={syn.category === "dis_synergy"} />
            ))}

            {/* Pro forma */}
            <tr style={{ background: COLORS.totalBg, borderTop: `2px solid ${COLORS.accent}` }}>
              <td style={{ padding: "10px 16px", fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>Pro Forma Adjusted EBITDA (Yr 1)</td>
              <td style={{ textAlign: "right", padding: "10px 16px", fontWeight: 700, color: COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.year_1.current)}</td>
              <td></td>
            </tr>
            <tr style={{ background: COLORS.totalBg }}>
              <td style={{ padding: "10px 16px", fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>Pro Forma Adjusted EBITDA (Steady State)</td>
              <td style={{ textAlign: "right", padding: "10px 16px", fontWeight: 700, color: COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollar(pf.steady_state.current)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// PIPELINE TAB
// ============================================================

function PipelineTab({ period }: { period: string }) {
  const [data, setData] = useState<PipelineReportData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPipelineReport(period)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState message="Loading pipeline data..." />;
  if (error || !data) return <ErrorState error={error || "No data"} onRetry={load} />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
      {data.map((panel) => (
        <div key={panel.entity_id} style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>{panel.entity_name}</div>
            <div style={{ fontSize: 15, color: COLORS.textDim }}>{panel.period}</div>
          </div>
          {panel.stages.length > 0 ? (
            <React.Suspense fallback={<div style={{ height: 120, background: COLORS.bg, borderRadius: 4 }} />}>
              <SalesFunnel data={{ title: '', stages: panel.stages, unit: "usd_millions", format: "currency" }} />
            </React.Suspense>
          ) : (
            <div style={{ padding: 24, textAlign: "center", color: COLORS.textMuted, fontSize: 15 }}>
              Pipeline data not available for {panel.entity_name}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// WHAT-IF TAB
// ============================================================

function WhatIfTab({ period }: { period: string }) {
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [levers, setLevers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wiKpi, setWiKpi] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchWhatIf(undefined, undefined, undefined, period)
      .then((r) => { setResult(r); setLevers(r.levers); })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [period]);

  const applyPreset = useCallback(async (preset: string) => {
    setLoading(true);
    try {
      const r = await fetchWhatIf(undefined, preset, undefined, period);
      setResult(r);
      setLevers(r.levers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [period]);

  const applyLevers = useCallback(async (newLevers: Record<string, number>) => {
    setLevers(newLevers);
    try {
      const r = await fetchWhatIf(newLevers, undefined, undefined, period);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [period]);

  if (loading && !result) return <LoadingState message="Loading what-if engine..." />;
  if (error && !result) return <ErrorState error={error} onRetry={() => { setLoading(true); setError(null); fetchWhatIf(undefined, undefined, undefined, period).then((r) => { setResult(r); setLevers(r.levers); }).catch((e) => setError(String(e))).finally(() => setLoading(false)); }} />;
  if (!result) return null;

  const defs = result.lever_definitions || [];
  const presetNames = result.presets ? Object.keys(result.presets) : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 24 }}>
      {/* Left: Levers */}
      <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px", maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>Sensitivity Levers</div>

        {/* Presets */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
          {presetNames.map((p) => (
            <button key={p} onClick={() => applyPreset(p)} style={{
              padding: "4px 10px", fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: "rgba(199,120,64,0.08)", color: COLORS.accent,
              border: `1px solid ${COLORS.accent}33`, borderRadius: 3,
              fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase",
            }}>{p.replace(/_/g, " ")}</button>
          ))}
        </div>

        {defs.map((d) => {
          const isDisabled = !!d.disabled;
          return (
          <div key={d.name} style={{ marginBottom: 14, opacity: isDisabled ? 0.4 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 15, color: COLORS.textMuted, fontFamily: "'IBM Plex Sans',sans-serif" }}>
                {d.label}{isDisabled ? " (disabled)" : ""}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>
                {levers[d.name] ?? d.default}{d.unit === "%" ? "%" : d.unit === "x" ? "x" : d.unit === "$M" ? "M" : d.unit === "months" ? "mo" : ""}
              </span>
            </div>
            <input type="range" min={d.min} max={d.max} step={d.unit === "x" ? 0.5 : 1}
              value={levers[d.name] ?? d.default}
              disabled={isDisabled}
              onChange={(e) => {
                if (isDisabled) return;
                const val = parseFloat(e.target.value);
                const next = { ...levers, [d.name]: val };
                applyLevers(next);
              }}
              style={{ width: "100%", accentColor: COLORS.accent }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: COLORS.textDim }}>
              <span>{d.min}{d.unit === "%" ? "%" : d.unit === "x" ? "x" : ""}</span>
              <span>{d.max}{d.unit === "%" ? "%" : d.unit === "x" ? "x" : ""}</span>
            </div>
            {d.impact_per_point_M != null && !isDisabled && (
              <div style={{ fontSize: 11, color: COLORS.textDim, textAlign: "right", marginTop: 2, fontFamily: "'IBM Plex Mono',monospace" }}>
                {d.unit === "x" ? "per 1x" : "per 1pp"}: {d.impact_per_point_M >= 0 ? "+" : ""}{fmtDollarM(d.impact_per_point_M)} EV
              </div>
            )}
          </div>
          );
        })}
      </div>

      {/* Right: Results */}
      <div>
        {/* Degraded mode warning */}
        {result.warning && (
          <div style={{ background: "rgba(199,120,64,0.12)", border: `1px solid ${COLORS.accent}`, borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: COLORS.accent, fontFamily: "'IBM Plex Sans',sans-serif", lineHeight: 1.5 }}>
            {result.warning}
          </div>
        )}

        {/* KPI boxes — drillable */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {([
              { id: "wi_reported", label: "Reported EBITDA", value: fmtDollarM(result.reported_ebitda) },
              { id: "wi_adjusted", label: "Entity Adjusted", value: fmtDollarM(result.entity_adjusted_ebitda) },
              { id: "wi_pf1", label: "Pro Forma Yr 1", value: fmtDollarM(result.pro_forma_ebitda.year_1) },
              { id: "wi_pfss", label: "Pro Forma SS", value: fmtDollarM(result.pro_forma_ebitda.steady_state) },
              { id: "wi_ev1", label: "EV (Yr 1)", value: fmtDollarM(result.ev_impact.year_1) },
              { id: "wi_evss", label: "EV (SS)", value: fmtDollarM(result.ev_impact.steady_state) },
            ] as const).map((kpi) => {
              const isExp = wiKpi === kpi.id;
              return (
                <div key={kpi.id} onClick={() => setWiKpi(isExp ? null : kpi.id)} style={{ background: isExp ? COLORS.surfaceHover : COLORS.surface, border: `1px solid ${isExp ? COLORS.accent : COLORS.border}`, borderRadius: 8, padding: "12px 16px", flex: "1 1 140px", cursor: "pointer", transition: "border-color 0.15s" }}>
                  <div style={{ fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>
                    <span style={{ color: COLORS.accent, marginRight: 4, fontSize: 10 }}>{isExp ? "\u25BE" : "\u25B8"}</span>
                    {kpi.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace", marginTop: 2 }}>{kpi.value}</div>
                </div>
              );
            })}
          </div>

          {/* Drill-through panel */}
          {wiKpi && (() => {
            const adjTotal = (result.adjustments || []).reduce((s, a) => s + a.amount, 0);
            const synTotal = (result.synergies || []).reduce((s, a) => s + a.amount, 0);
            const adjRows = result.adjustments || [];
            const synRows = result.synergies || [];
            const thD: React.CSSProperties = { textAlign: "left", padding: "4px 12px", color: COLORS.textDim, fontSize: 14, fontWeight: 500 };
            const thDR: React.CSSProperties = { ...thD, textAlign: "right" };

            const adjTable = (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <th style={thD}>Adjustment</th>
                    <th style={thDR}>Amount</th>
                    <th style={{ ...thD, textAlign: "center" }}>Conf.</th>
                    <th style={thD}>Lever</th>
                  </tr>
                </thead>
                <tbody>
                  {adjRows.map((a) => (
                    <tr key={a.name} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "5px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>{a.name}</td>
                      <td style={{ textAlign: "right", padding: "5px 12px", color: a.amount >= 0 ? COLORS.green : COLORS.red, fontFamily: "'IBM Plex Mono',monospace" }}>{a.amount >= 0 ? "+" : ""}{fmtDollarM(a.amount)}</td>
                      <td style={{ textAlign: "center", padding: "5px 8px" }}>
                        <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, fontWeight: 600, color: confidenceColor(a.confidence), background: a.confidence === "high" ? COLORS.greenBg : a.confidence === "medium" ? "rgba(199,120,64,0.08)" : COLORS.redBg }}>{a.confidence.toUpperCase()}</span>
                      </td>
                      <td style={{ padding: "5px 12px", color: COLORS.textMuted, fontSize: 15 }}>{a.lever || "—"}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                    <td style={{ padding: "5px 12px", color: COLORS.text, fontWeight: 700 }}>Total Adjustments</td>
                    <td style={{ textAlign: "right", padding: "5px 12px", color: COLORS.text, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{adjTotal >= 0 ? "+" : ""}{fmtDollarM(adjTotal)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            );

            const synTable = (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <th style={thD}>Synergy</th>
                    <th style={thDR}>Amount</th>
                    <th style={{ ...thD, textAlign: "center" }}>Conf.</th>
                    <th style={thD}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {synRows.map((s) => (
                    <tr key={s.name} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "5px 12px", color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif" }}>{s.name}</td>
                      <td style={{ textAlign: "right", padding: "5px 12px", color: s.category === "dis_synergy" ? COLORS.red : COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>
                        {s.category === "dis_synergy" ? `(${fmtDollarM(Math.abs(s.amount))})` : `+${fmtDollarM(s.amount)}`}
                      </td>
                      <td style={{ textAlign: "center", padding: "5px 8px" }}>
                        <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, fontWeight: 600, color: confidenceColor(s.confidence), background: s.confidence === "high" ? COLORS.greenBg : s.confidence === "medium" ? "rgba(199,120,64,0.08)" : COLORS.redBg }}>{s.confidence.toUpperCase()}</span>
                      </td>
                      <td style={{ padding: "5px 12px", color: COLORS.textMuted, fontSize: 15 }}>{s.category.replace(/_/g, " ")}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                    <td style={{ padding: "5px 12px", color: COLORS.text, fontWeight: 700 }}>Net Synergies</td>
                    <td style={{ textAlign: "right", padding: "5px 12px", color: COLORS.text, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{synTotal >= 0 ? "+" : ""}{fmtDollarM(synTotal)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            );

            return (
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.accent}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 20px", marginTop: -1 }}>
                {wiKpi === "wi_reported" && (
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Reported EBITDA — Baseline</div>
                    <div style={{ fontSize: 14, color: COLORS.textMuted, lineHeight: 1.6 }}>
                      <div>This is the unadjusted, as-reported combined EBITDA before any normalization adjustments or synergy assumptions.</div>
                      <div style={{ marginTop: 8, display: "flex", gap: 24 }}>
                        <div><span style={{ color: COLORS.textDim }}>Value:</span> <span style={{ fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollarM(result.reported_ebitda)}</span></div>
                        <div><span style={{ color: COLORS.textDim }}>Adjustments pending:</span> <span style={{ fontWeight: 600, color: COLORS.accent }}>{adjRows.length} items ({adjTotal >= 0 ? "+" : ""}{fmtDollarM(adjTotal)})</span></div>
                      </div>
                    </div>
                  </div>
                )}
                {wiKpi === "wi_adjusted" && (
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Entity-Adjusted EBITDA Build-Up</div>
                    <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 10 }}>
                      Reported {fmtDollarM(result.reported_ebitda)} + adjustments {adjTotal >= 0 ? "+" : ""}{fmtDollarM(adjTotal)} = <span style={{ fontWeight: 700, color: COLORS.text }}>{fmtDollarM(result.entity_adjusted_ebitda)}</span>
                    </div>
                    {adjTable}
                  </div>
                )}
                {wiKpi === "wi_pf1" && (
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pro Forma Year 1 Build-Up</div>
                    <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 10 }}>
                      Adjusted {fmtDollarM(result.entity_adjusted_ebitda)} + net synergies {synTotal >= 0 ? "+" : ""}{fmtDollarM(synTotal)} = <span style={{ fontWeight: 700, color: COLORS.green }}>{fmtDollarM(result.pro_forma_ebitda.year_1)}</span>
                    </div>
                    {synTable}
                  </div>
                )}
                {wiKpi === "wi_pfss" && (
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pro Forma Steady State Build-Up</div>
                    <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 10 }}>
                      Adjusted {fmtDollarM(result.entity_adjusted_ebitda)} + full synergy realization {synTotal >= 0 ? "+" : ""}{fmtDollarM(synTotal)} = <span style={{ fontWeight: 700, color: COLORS.green }}>{fmtDollarM(result.pro_forma_ebitda.steady_state)}</span>
                    </div>
                    <div style={{ marginBottom: 12 }}>{synTable}</div>
                    <div style={{ fontSize: 15, color: COLORS.textMuted, fontStyle: "italic" }}>Steady state assumes 100% synergy realization (typically 24–36 months post-close)</div>
                  </div>
                )}
                {wiKpi === "wi_ev1" && (
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Enterprise Value — Year 1</div>
                    <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 12 }}>
                      Pro Forma Yr 1 EBITDA {fmtDollarM(result.pro_forma_ebitda.year_1)} applied at current lever multiple
                    </div>
                    <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
                      <tbody>
                        <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                          <td style={{ padding: "5px 16px 5px 0", color: COLORS.textMuted }}>Pro Forma EBITDA (Yr 1)</td>
                          <td style={{ textAlign: "right", padding: "5px 0", color: COLORS.text, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollarM(result.pro_forma_ebitda.year_1)}</td>
                        </tr>
                        <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                          <td style={{ padding: "5px 16px 5px 0", color: COLORS.textMuted }}>Multiple (from lever)</td>
                          <td style={{ textAlign: "right", padding: "5px 0", color: COLORS.accent, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{levers["ev_multiple"] ?? result.ev_multiple ?? 8.0}x</td>
                        </tr>
                        <tr style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                          <td style={{ padding: "5px 16px 5px 0", color: COLORS.text, fontWeight: 700 }}>EV (Year 1)</td>
                          <td style={{ textAlign: "right", padding: "5px 0", color: COLORS.green, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollarM(result.ev_impact.year_1)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {wiKpi === "wi_evss" && (
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Enterprise Value — Steady State</div>
                    <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 12 }}>
                      Pro Forma SS EBITDA {fmtDollarM(result.pro_forma_ebitda.steady_state)} applied at current lever multiple
                    </div>
                    <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
                      <tbody>
                        <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                          <td style={{ padding: "5px 16px 5px 0", color: COLORS.textMuted }}>Pro Forma EBITDA (SS)</td>
                          <td style={{ textAlign: "right", padding: "5px 0", color: COLORS.text, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollarM(result.pro_forma_ebitda.steady_state)}</td>
                        </tr>
                        <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                          <td style={{ padding: "5px 16px 5px 0", color: COLORS.textMuted }}>Multiple (from lever)</td>
                          <td style={{ textAlign: "right", padding: "5px 0", color: COLORS.accent, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace" }}>{levers["ev_multiple"] ?? result.ev_multiple ?? 8.0}x</td>
                        </tr>
                        <tr style={{ borderTop: `1px solid ${COLORS.borderLight}` }}>
                          <td style={{ padding: "5px 16px 5px 0", color: COLORS.text, fontWeight: 700 }}>EV (Steady State)</td>
                          <td style={{ textAlign: "right", padding: "5px 0", color: COLORS.green, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtDollarM(result.ev_impact.steady_state)}</td>
                        </tr>
                        <tr style={{ borderTop: `1px solid ${COLORS.border}22` }}>
                          <td style={{ padding: "5px 16px 5px 0", color: COLORS.textMuted, fontSize: 15 }}>Incremental vs Reported</td>
                          <td style={{ textAlign: "right", padding: "5px 0", color: COLORS.accent, fontWeight: 600, fontFamily: "'IBM Plex Mono',monospace", fontSize: 15 }}>+{fmtDollarM(result.ev_impact.steady_state - result.ev_impact.year_1)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// QofE TAB
// ============================================================

type QofESubView = "bridge" | "ebitda_bridge" | "sustainability" | "revenue" | "working_capital" | "new_items";

function QofETab() {
  const [data, setData] = useState<QofEData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subView, setSubView] = useState<QofESubView>("bridge");
  const [expandedAdj, setExpandedAdj] = useState<string | null>(null);

  useEffect(() => {
    fetchQofE()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading Quality of Earnings..." />;
  if (error || !data) return <ErrorState error={error || "No data"} onRetry={() => { setLoading(true); setError(null); fetchQofE().then(setData).catch((e) => setError(String(e))).finally(() => setLoading(false)); }} />;

  const sus = data.sustainability_score;
  const rq = data.revenue_quality;
  const wc = data.working_capital;
  const summary = data.summary;

  const subTabs: { id: QofESubView; label: string }[] = [
    { id: "bridge", label: "QofE" },
    { id: "ebitda_bridge", label: "EBITDA Bridge" },
    { id: "sustainability", label: "Sustainability" },
    { id: "revenue", label: "Revenue Quality" },
    { id: "working_capital", label: "Working Capital" },
    { id: "new_items", label: `New Items (${data.new_items.length})` },
  ];

  const statusColor = (s: string) => s === "active" ? COLORS.green : s === "resolved" ? COLORS.textDim : s === "new" ? COLORS.accent : COLORS.red;
  const statusBg = (s: string) => s === "active" ? COLORS.greenBg : s === "resolved" ? `${COLORS.textDim}15` : s === "new" ? "rgba(199,120,64,0.08)" : COLORS.redBg;
  const trendIcon = (t: string) => t === "improving" ? "↑" : t === "worsening" ? "↓" : "→";
  const trendColor = (t: string) => t === "improving" ? COLORS.green : t === "worsening" ? COLORS.red : COLORS.textMuted;

  return (
    <div>
      {/* Top KPIs */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "14px 18px", flex: "1 1 160px" }}>
          <div style={{ fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>Sustainability Score</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: sus.overall >= 65 ? COLORS.green : sus.overall >= 50 ? COLORS.accent : COLORS.red, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{sus.overall.toFixed(0)}<span style={{ fontSize: 16, fontWeight: 400, color: COLORS.textMuted }}>/100</span></div>
          <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textDim, marginTop: 2 }}>Grade: {sus.grade}</div>
        </div>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "14px 18px", flex: "1 1 160px" }}>
          <div style={{ fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>Adjusted EBITDA</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{fmtDollar(summary.entity_adjusted_ebitda)}</div>
        </div>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "14px 18px", flex: "1 1 160px" }}>
          <div style={{ fontSize: 14, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono',monospace" }}>Period</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.text, marginTop: 4 }}>{data.period}</div>
          <div style={{ fontSize: 14, color: COLORS.textDim, marginTop: 2 }}>{data.is_initial_diligence ? "Initial Diligence" : "Ongoing QofE"}</div>
        </div>
      </div>

      {/* Sub-view tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {subTabs.map((st) => (
          <button key={st.id} onClick={() => setSubView(st.id)} style={{
            padding: "6px 16px", fontSize: 15, fontWeight: subView === st.id ? 700 : 400,
            background: subView === st.id ? "rgba(199,120,64,0.12)" : "transparent",
            color: subView === st.id ? COLORS.accent : COLORS.textMuted,
            border: subView === st.id ? `1px solid ${COLORS.accent}44` : `1px solid ${COLORS.border}`,
            borderRadius: 6, cursor: "pointer", fontFamily: "'IBM Plex Sans',sans-serif",
          }}>{st.label}</button>
        ))}
      </div>

      {/* Sub-view content */}
      {subView === "bridge" && (
        <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                <th style={{ textAlign: "left", padding: "6px 12px", color: COLORS.textDim, fontSize: 14, textTransform: "uppercase" }}>Adjustment</th>
                <th style={{ textAlign: "right", padding: "6px 12px", color: COLORS.textDim, fontSize: 14 }}>Current</th>
                <th style={{ textAlign: "right", padding: "6px 12px", color: COLORS.textDim, fontSize: 14 }}>Diligence</th>
                <th style={{ textAlign: "right", padding: "6px 12px", color: COLORS.textDim, fontSize: 14 }}>Prior</th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: COLORS.textDim, fontSize: 14 }}>Status</th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: COLORS.textDim, fontSize: 14 }}>Trend</th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: COLORS.textDim, fontSize: 14 }}>Conf.</th>
              </tr>
            </thead>
            <tbody>
              {data.ebitda_bridge.map((row) => {
                const isExp = expandedAdj === row.name;
                return (
                  <React.Fragment key={row.name}>
                    <tr onClick={() => setExpandedAdj(isExp ? null : row.name)} style={{ cursor: "pointer", borderBottom: `1px solid ${COLORS.border}15`, background: isExp ? COLORS.surfaceHover : "transparent" }}>
                      <td style={{ padding: "6px 12px", color: COLORS.text }}>
                        <span style={{ color: COLORS.accent, marginRight: 6, fontSize: 11 }}>{isExp ? "\u25BE" : "\u25B8"}</span>
                        {row.name}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px 12px", fontFamily: "'IBM Plex Mono',monospace", color: COLORS.text }}>{fmtDollar(row.current_amount)}</td>
                      <td style={{ textAlign: "right", padding: "6px 12px", fontFamily: "'IBM Plex Mono',monospace", color: COLORS.textMuted }}>{row.diligence_amount !== null ? fmtDollar(row.diligence_amount) : "—"}</td>
                      <td style={{ textAlign: "right", padding: "6px 12px", fontFamily: "'IBM Plex Mono',monospace", color: COLORS.textMuted }}>{row.prior_amount !== null ? fmtDollar(row.prior_amount) : "—"}</td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, fontWeight: 600, color: statusColor(row.status), background: statusBg(row.status) }}>{row.status.toUpperCase()}</span>
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 8px", color: trendColor(row.trend), fontWeight: 600, fontSize: 16 }}>{trendIcon(row.trend)}</td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, fontWeight: 600, color: confidenceColor(row.confidence), background: row.confidence === "high" ? COLORS.greenBg : row.confidence === "medium" ? "rgba(199,120,64,0.08)" : COLORS.redBg }}>{row.confidence.toUpperCase()}</span>
                      </td>
                    </tr>
                    {isExp && (
                      <tr style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                        <td colSpan={7} style={{ padding: "8px 20px 12px 36px", background: COLORS.surface }}>
                          <div style={{ fontSize: 15, color: COLORS.textMuted, lineHeight: 1.6 }}>
                            <div><span style={{ color: COLORS.textDim }}>Range:</span> {fmtDollar(row.amount_low)} — {fmtDollar(row.amount_high)}</div>
                            <div><span style={{ color: COLORS.textDim }}>Category:</span> {row.category.replace(/_/g, " ")}</div>
                            <div><span style={{ color: COLORS.textDim }}>Entity:</span> {row.entity}</div>
                            <div><span style={{ color: COLORS.textDim }}>Lifecycle:</span> {row.lifecycle_stage}</div>
                            {row.lever && <div><span style={{ color: COLORS.textDim }}>Lever:</span> {row.lever}</div>}
                            <div style={{ marginTop: 4 }}><span style={{ color: COLORS.textDim }}>Support:</span> {row.support_reference}</div>
                            <div style={{ marginTop: 4, fontStyle: "italic" }}>{row.rationale}</div>
                            {row.lifecycle_history && row.lifecycle_history.length > 0 && (
                              <div style={{ marginTop: 10, borderTop: `1px solid ${COLORS.border}`, paddingTop: 8 }}>
                                <div style={{ fontSize: 12, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Lifecycle History</div>
                                {row.lifecycle_history.map((entry, idx) => {
                                  const prev = idx > 0 ? row.lifecycle_history![idx - 1] : null;
                                  const delta = prev ? entry.amount - prev.amount : null;
                                  const deltaPct = prev && prev.amount !== 0 ? (delta! / Math.abs(prev.amount)) * 100 : null;
                                  const stageName = entry.stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                                  return (
                                    <div key={entry.stage} style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 14, fontFamily: "'IBM Plex Mono',monospace", marginBottom: 2 }}>
                                      <span style={{ width: 160, color: COLORS.textMuted, fontFamily: "'IBM Plex Sans',sans-serif" }}>{stageName}</span>
                                      <span style={{ color: COLORS.text }}>{"\u2192"} {fmtDollar(entry.amount)}</span>
                                      <span style={{ color: COLORS.textDim, fontSize: 12 }}>(conf: {entry.confidence.toFixed(2)})</span>
                                      {delta !== null && (
                                        <span style={{ color: delta >= 0 ? COLORS.green : COLORS.red, fontSize: 12 }}>
                                          {delta >= 0 ? "+" : ""}{fmtDollar(delta)} ({deltaPct!.toFixed(1)}%)
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {subView === "sustainability" && (
        <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 15, color: COLORS.textDim, fontFamily: "'IBM Plex Sans',sans-serif" }}>Sustainability analysis — coming soon</div>
        </div>
      )}

      {subView === "revenue" && (() => {
        const revMixStreams = [
          { name: "Consulting / T&M", value: rq.revenue_mix.consulting_tm_M },
          { name: "Managed Services", value: rq.revenue_mix.managed_services_M },
          { name: "Per-FTE", value: rq.revenue_mix.per_fte_M },
          { name: "Per-Transaction", value: rq.revenue_mix.per_transaction_M },
          { name: "Fixed Fee", value: rq.revenue_mix.fixed_fee_M },
        ].filter(d => d.value > 0);
        const revMixColors = [COLORS.accent, COLORS.green, COLORS.blue, "#A78BFA", "#F59E0B"];
        const hasConcentrationData = rq.customer_concentration.total_customers > 0;
        const hasContractData = rq.contract_quality.msa_pct > 0 || rq.contract_quality.sow_pct > 0 || rq.contract_quality.t_and_m_pct > 0;
        const placeholderStyle: React.CSSProperties = { fontSize: 14, color: COLORS.textDim, fontStyle: "italic", padding: "8px 0" };

        return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Revenue mix with donut chart */}
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Revenue Mix</div>
            {revMixStreams.length > 0 ? (
              <div style={{ display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ width: 220, height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={revMixStreams} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" nameKey="name" strokeWidth={0}
                        label={({ name, percent }: any) => `${name || ""} ${((percent || 0) * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {revMixStreams.map((_entry, index) => (
                          <Cell key={index} fill={revMixColors[index % revMixColors.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, color: COLORS.textDim }}>Recurring</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.green, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.revenue_mix.recurring_pct}%</div>
                      <div style={{ fontSize: 13, color: COLORS.textMuted }}>{[rq.revenue_mix.consulting_tm_M > 0 && `T&M $${rq.revenue_mix.consulting_tm_M}M`, rq.revenue_mix.managed_services_M > 0 && `Managed $${rq.revenue_mix.managed_services_M}M`, rq.revenue_mix.per_fte_M > 0 && `Per-FTE $${rq.revenue_mix.per_fte_M}M`, rq.revenue_mix.per_transaction_M > 0 && `Per-Txn $${rq.revenue_mix.per_transaction_M}M`].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, color: COLORS.textDim }}>Non-Recurring</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.accent, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.revenue_mix.non_recurring_pct}%</div>
                      <div style={{ fontSize: 13, color: COLORS.textMuted }}>{rq.revenue_mix.fixed_fee_M > 0 ? `Fixed Fee $${rq.revenue_mix.fixed_fee_M}M` : "—"}</div>
                    </div>
                  </div>
                  {/* Legend */}
                  <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                    {revMixStreams.map((s, i) => (
                      <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: revMixColors[i % revMixColors.length] }} />
                        <span style={{ fontSize: 12, color: COLORS.textMuted }}>{s.name} ${s.value}M</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={placeholderStyle}>Data not available — requires revenue sub-ledger enrichment input</div>
            )}
          </div>

          {/* Customer concentration */}
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Customer Concentration</div>
            {hasConcentrationData ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
                  <div><div style={{ fontSize: 14, color: COLORS.textDim }}>HHI Index</div><div style={{ fontSize: 20, fontWeight: 700, color: rq.customer_concentration.hhi < 1500 ? COLORS.green : COLORS.red, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.customer_concentration.hhi.toFixed(0)}</div></div>
                  <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Top 10 %</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.customer_concentration.top_10_pct.toFixed(1)}%</div></div>
                  <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Top 20 %</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.customer_concentration.top_20_pct.toFixed(1)}%</div></div>
                  <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Customers</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.customer_concentration.total_customers.toLocaleString()}</div></div>
                </div>
                {rq.customer_concentration.threshold_alerts.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.red, marginBottom: 4 }}>THRESHOLD ALERTS</div>
                    {rq.customer_concentration.threshold_alerts.map((a) => (
                      <div key={a.customer} style={{ fontSize: 15, color: COLORS.textMuted }}>{a.customer}: {a.pct}% (crossed {a.threshold})</div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={placeholderStyle}>Data not available — requires customer-level revenue sub-ledger input</div>
            )}
          </div>

          {/* Contract quality */}
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Contract Quality</div>
            {hasContractData ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <div><div style={{ fontSize: 14, color: COLORS.textDim }}>MSA %</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.contract_quality.msa_pct}%</div></div>
                <div><div style={{ fontSize: 14, color: COLORS.textDim }}>SOW %</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.contract_quality.sow_pct}%</div></div>
                <div><div style={{ fontSize: 14, color: COLORS.textDim }}>T&M %</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.contract_quality.t_and_m_pct}%</div></div>
                <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Avg Tenure</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.contract_quality.avg_tenure_years} yrs</div></div>
              </div>
            ) : (
              <div style={placeholderStyle}>Data not available — requires contract management system integration</div>
            )}
          </div>

          {/* Revenue trending */}
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Revenue Trending</div>
            <div style={placeholderStyle}>Data not available — requires quarterly revenue time series from sub-ledger</div>
          </div>

          {/* Cross-sell penetration */}
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Cross-Sell Penetration</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Candidates</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.cross_sell_penetration.total_candidates}</div></div>
              <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Pipeline ACV</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>${rq.cross_sell_penetration.total_pipeline_acv_M}M</div></div>
              <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Converted</div><div style={{ fontSize: 20, fontWeight: 700, color: rq.cross_sell_penetration.converted_count > 0 ? COLORS.green : COLORS.textDim, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.cross_sell_penetration.converted_count}</div></div>
            </div>
          </div>

          {/* Upsell penetration */}
          {rq.upsell_penetration && (
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Upsell Penetration</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Shared Customers</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.upsell_penetration.shared_customers}</div></div>
              <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Expansion ACV</div><div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>${rq.upsell_penetration.total_expansion_acv_M}M</div></div>
              <div><div style={{ fontSize: 14, color: COLORS.textDim }}>Avg Score</div><div style={{ fontSize: 20, fontWeight: 700, color: rq.upsell_penetration.avg_upsell_score >= 70 ? COLORS.green : COLORS.textDim, fontFamily: "'IBM Plex Mono',monospace" }}>{rq.upsell_penetration.avg_upsell_score}</div></div>
            </div>
          </div>
          )}
        </div>
        );
      })()}

      {subView === "working_capital" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* DSO trend */}
          {([
            { label: "DSO (Days Sales Outstanding)", data: wc.dso_trend, unit: " days" },
            { label: "DPO (Days Payable Outstanding)", data: wc.dpo_trend, unit: " days" },
            { label: "Bench Cost ($M)", data: wc.bench_cost_trend, unit: "M" },
          ] as const).map((metric) => (
            <div key={metric.label} style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{metric.label}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {metric.data.map((d, i) => (
                  <div key={d.period} style={{ textAlign: "center", minWidth: 60 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: i === metric.data.length - 1 ? COLORS.accent : COLORS.text, fontFamily: "'IBM Plex Mono',monospace" }}>{d.value.toFixed(1)}{metric.unit}</div>
                    <div style={{ fontSize: 11, color: COLORS.textDim }}>{d.period}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Margin trend */}
          <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, padding: "16px 20px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.accent, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Margin Trend</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <th style={{ textAlign: "left", padding: "4px 8px", color: COLORS.textDim, fontSize: 14 }}>Period</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: COLORS.textDim, fontSize: 14 }}>Gross Margin</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: COLORS.textDim, fontSize: 14 }}>EBITDA Margin</th>
                </tr>
              </thead>
              <tbody>
                {wc.margin_trend.map((m, i) => (
                  <tr key={m.period} style={{ borderBottom: `1px solid ${COLORS.border}15` }}>
                    <td style={{ padding: "4px 8px", color: i === wc.margin_trend.length - 1 ? COLORS.accent : COLORS.textMuted }}>{m.period}</td>
                    <td style={{ textAlign: "right", padding: "4px 8px", fontFamily: "'IBM Plex Mono',monospace", color: COLORS.text }}>{m.gross_margin_pct.toFixed(1)}%</td>
                    <td style={{ textAlign: "right", padding: "4px 8px", fontFamily: "'IBM Plex Mono',monospace", color: COLORS.text }}>{m.ebitda_margin_pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subView === "new_items" && (
        <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
          {data.new_items.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: COLORS.textMuted, fontSize: 15 }}>No new items detected this period.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <th style={{ textAlign: "left", padding: "6px 12px", color: COLORS.textDim, fontSize: 14, textTransform: "uppercase" }}>Description</th>
                  <th style={{ textAlign: "right", padding: "6px 12px", color: COLORS.textDim, fontSize: 14 }}>Amount</th>
                  <th style={{ textAlign: "center", padding: "6px 8px", color: COLORS.textDim, fontSize: 14 }}>Classification</th>
                  <th style={{ textAlign: "center", padding: "6px 8px", color: COLORS.textDim, fontSize: 14 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.new_items.map((item, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}15` }}>
                    <td style={{ padding: "6px 12px", color: COLORS.text }}>{item.description}</td>
                    <td style={{ textAlign: "right", padding: "6px 12px", fontFamily: "'IBM Plex Mono',monospace", color: item.amount >= 0 ? COLORS.green : COLORS.red }}>{fmtDollar(item.amount)}</td>
                    <td style={{ textAlign: "center", padding: "6px 8px" }}>
                      <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, fontWeight: 600, color: COLORS.accent, background: "rgba(199,120,64,0.08)" }}>{item.classification_suggestion.toUpperCase()}</span>
                    </td>
                    <td style={{ textAlign: "center", padding: "6px 8px" }}>
                      <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 3, fontWeight: 600, color: item.recommended_action === "add_to_bridge" ? COLORS.green : COLORS.textMuted, background: item.recommended_action === "add_to_bridge" ? COLORS.greenBg : `${COLORS.textDim}15` }}>{item.recommended_action.replace(/_/g, " ").toUpperCase()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {subView === "ebitda_bridge" && <EBITDABridgeTab />}
    </div>
  );
}


// ============================================================
// MAIN COMPONENT
// ============================================================
export function ReportPortal({ onClose: _onClose }: { onClose: () => void }) {
  // Read entity from URL search params for Console iframe embedding
  const searchParams = new URLSearchParams(window.location.search);
  const entityFromUrl = searchParams.get("entity");

  const [entity, setEntity] = useState<EntitySelection>(
    (entityFromUrl as EntitySelection) || "combined"
  );
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [tab, setTab] = useState("pl");
  const [variant, setVariant] = useState("act_vs_py");
  const [quarter, setQuarter] = useState("2025-Q3");
  const [segment, setSegment] = useState("all");

  // Dimension state — fetched from API on mount
  const [dimensions, setDimensions] = useState<{ periods: PeriodDimension[]; segments: string[] } | null>(null);
  const [dimensionsError, setDimensionsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReportDimensions()
      .then((dims) => {
        if (!cancelled) {
          setDimensions(dims);
          setDimensionsError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setDimensionsError(err.message || "Failed to load report dimensions");
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Data states
  const [currentData, setCurrentData] = useState<ReportData | null>(null);
  const [pyData, setPyData] = useState<ReportData | null>(null);
  const [rawFSData, setRawFSData] = useState<FinancialStatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Combining statement data states
  const [combiningData, setCombiningData] = useState<CombiningStatementData | null>(null);
  const [combiningLoading, setCombiningLoading] = useState(false);
  const [combiningError, setCombiningError] = useState<string | null>(null);
  const [combiningVariant, setCombiningVariant] = useState("act_vs_py");
  const [combiningQuarter, setCombiningQuarter] = useState("2025-Q3");
  const [combiningSegment, setCombiningSegment] = useState("all");

  // Derive available quarters from API dimensions, filtering by entity data availability
  const entityKey = entity === "combined" ? null : entity;
  const actQuarters = useMemo(() => {
    if (!dimensions) return [];
    return dimensions.periods
      .filter((p) => {
        if (p.period_type !== "actual") return false;
        if (!entityKey) return Object.values(p.has_data).some(Boolean);
        return p.has_data[entityKey];
      })
      .map((p) => p.label);
  }, [dimensions, entityKey]);
  const cfQuarters = useMemo(() => {
    if (!dimensions) return [];
    const cy = wallClockDate().getFullYear();
    return dimensions.periods
      .filter((p) => p.period_type === "forecast" && p.year === cy)
      .map((p) => p.label);
  }, [dimensions]);
  const availableSegments = dimensions?.segments ?? SEGMENTS_FALLBACK;
  const lastFullYear = wallClockDate().getFullYear() - 1;
  const pyYear = lastFullYear - 1;

  // Sync quarter selectors to latest actual quarter when dimensions load
  useEffect(() => {
    if (actQuarters.length > 0) {
      const latest = actQuarters[actQuarters.length - 1];
      setQuarter(latest);
      setCombiningQuarter(latest);
    }
  }, [actQuarters]);

  const handleEntityChange = useCallback((e: EntitySelection) => {
    setEntity(e);
    // Reset to a valid tab when switching entity mode
    const combinedOnlyTabs = ["combining", "overlap", "crosssell", "whatif", "qoe"];
    if (e !== "combined" && combinedOnlyTabs.includes(tab)) {
      setTab("pl");
    }
  }, [tab]);

  const handleTabChange = useCallback((t: string) => {
    setTab(t);
  }, []);

  // ── Parent iframe navigation via custom events ────────────────────
  // Dispatched by App.tsx postMessage handler when it receives 'reportNavigate'
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      console.log('[ReportPortal] aos-report-navigate:', detail)
      if (detail.entity) {
        handleEntityChange(detail.entity)
      }
      if (detail.tab) {
        // Small delay so entity change settles first (tab list depends on entity)
        setTimeout(() => handleTabChange(detail.tab), 50)
      }
    }
    window.addEventListener('aos-report-navigate', handler)
    return () => window.removeEventListener('aos-report-navigate', handler)
  }, [handleEntityChange, handleTabChange])


  const statementTabs = useMemo(() => {
    const base = [
      { id: "pl", label: "P&L", title: "Income Statement" },
      { id: "bs", label: "BS", title: "Balance Sheet" },
      { id: "cf", label: "CF", title: "Cash Flow Statement" },
    ];
    if (entity === "combined") {
      return [
        ...base,
        { id: "combining", label: "Combining" },
        { id: "overlap", label: "Overlap", title: "Entity Overlap" },
        { id: "crosssell", label: "X-Sell", title: "Cross-Sell Pipeline" },
        { id: "upsell", label: "Upsell", title: "Upsell Opportunities" },
        { id: "pipeline", label: "Pipeline" },
        { id: "whatif", label: "What-If" },
        { id: "qoe", label: "QofE", title: "Quality of Earnings" },
      ];
    }
    return [
      ...base,
      { id: "rev_by_customer", label: "Rev/Cust", title: "Revenue by Customer" },
      { id: "pipeline", label: "Pipeline" },
    ];
  }, [entity]);

  const variantOptions = [
    { value: "act_vs_py", label: `FY${lastFullYear} Act vs FY${pyYear}` },
    { value: "q_act_vs_py", label: "Quarterly Act vs PY" },
    { value: "cf_vs_py", label: `FY${wallClockDate().getFullYear()} CF vs FY${lastFullYear}` },
    { value: "q_cf_vs_py", label: "Quarterly CF vs PY" },
  ];

  const showQuarterSelect = variant === "q_act_vs_py" || variant === "q_cf_vs_py" || variant === "quarterly";
  const quarterOptions = variant === "q_cf_vs_py"
    ? cfQuarters.map((q) => ({ value: q, label: q }))
    : actQuarters.map((q) => ({ value: q, label: q }));

  const seg = segment === "all" ? null : segment;
  const isStatementTab = tab === "pl" || tab === "bs" || tab === "cf";
  const isPeriodTab = isStatementTab || tab === "pipeline" || tab === "whatif";

  // Determine the period to pass to the API based on the variant.
  // FY variants send year-level periods (e.g. "2025") — the backend
  // TripleQueryResolver expands these to Q1-Q4 SUM (or Q4 snapshot for BS).
  // Quarterly variants send quarter-level periods (e.g. "2025-Q3").
  const effectivePeriod = useMemo(() => {
    if (variant === "act_vs_py") return String(lastFullYear);
    if (variant === "q_act_vs_py") return quarter;
    if (variant === "cf_vs_py") return String(wallClockDate().getFullYear());
    if (variant === "q_cf_vs_py") return quarter || cfQuarters[0];
    if (variant === "quarterly") return quarter;
    return String(lastFullYear);
  }, [variant, quarter, lastFullYear, cfQuarters]);

  // Combining period mirrors IS variant logic
  const combiningPeriod = useMemo(() => {
    if (combiningVariant === "act_vs_py") return String(lastFullYear);
    if (combiningVariant === "q_act_vs_py") return combiningQuarter;
    if (combiningVariant === "cf_vs_py") return String(wallClockDate().getFullYear());
    if (combiningVariant === "q_cf_vs_py") return combiningQuarter || cfQuarters[0];
    return String(lastFullYear);
  }, [combiningVariant, combiningQuarter, lastFullYear, cfQuarters]);

  // Fetch report data when tab/variant/quarter/segment/entity changes.
  // Uses a fetchId counter to discard stale responses — when the user switches
  // tabs before the previous fetch completes, the old response is ignored
  // because its fetchId no longer matches the current ref value.
  const fetchIdRef = useRef(0);

  const loadReport = useCallback(async () => {
    if (!isStatementTab) return;
    const fetchId = ++fetchIdRef.current;

    if (dimensionsError) {
      setError("Cannot load report: dimensions failed to load. Refresh the page to retry.");
      return;
    }

    // Segment-level data not yet available in triple store
    if (seg) {
      setError("Segment-level data not yet available. Select 'All Segments' to view the full statement.");
      setCurrentData(null);
      setPyData(null);
      setRawFSData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const statement = tabToStatement(tab);
    const apiVariant = mapVariant(variant);
    const needsPY = variant !== "quarterly";

    // Compute prior-year period: "2025" → "2024", "2025-Q3" → "2024-Q3"
    let pyPeriod: string | undefined;
    if (needsPY) {
      const qMatch = effectivePeriod.match(/^(\d{4})(-Q\d)?$/);
      if (qMatch) {
        pyPeriod = String(Number(qMatch[1]) - 1) + (qMatch[2] || "");
      }
    }

    try {
      // Fetch current and PY periods in parallel
      const [result, pyResult] = await Promise.all([
        fetchReport(statement, apiVariant, effectivePeriod, seg, entity),
        needsPY && pyPeriod
          ? fetchReport(statement, apiVariant, pyPeriod, seg, entity).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (fetchIdRef.current !== fetchId) return; // stale response — discard
      setCurrentData(result.reportData);
      setRawFSData(result.rawFSData);
      setPyData(pyResult ? pyResult.reportData : null);
    } catch (err) {
      if (fetchIdRef.current !== fetchId) return; // stale error — discard
      setError(err instanceof Error ? err.message : String(err));
      setCurrentData(null);
      setPyData(null);
      setRawFSData(null);
    } finally {
      if (fetchIdRef.current === fetchId) {
        setLoading(false);
      }
    }
  }, [tab, variant, effectivePeriod, seg, isStatementTab, pyYear, lastFullYear, quarter, cfQuarters, entity, dimensionsError]);

  useEffect(() => {
    if (isStatementTab) {
      loadReport();
    }
  }, [loadReport, isStatementTab]);

  // Load combining statement data when the combining tab is active
  const combSeg = combiningSegment === "all" ? null : combiningSegment;
  const loadCombining = useCallback(async () => {
    if (tab !== "combining" || entity !== "combined") return;

    // Segment-level data not yet available in triple store
    if (combSeg) {
      setCombiningError("Segment-level data not yet available. Select 'All Segments' to view the combining statement.");
      setCombiningData(null);
      setCombiningLoading(false);
      return;
    }

    setCombiningLoading(true);
    setCombiningError(null);
    try {
      const result = await fetchCombiningStatement(combiningPeriod, combSeg);
      setCombiningData(result);
    } catch (err) {
      setCombiningError(err instanceof Error ? err.message : String(err));
      setCombiningData(null);
    } finally {
      setCombiningLoading(false);
    }
  }, [tab, entity, combiningPeriod, combSeg]);

  useEffect(() => {
    if (tab === "combining" && entity === "combined") {
      loadCombining();
    }
  }, [loadCombining, tab, entity]);



  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: COLORS.bg, color: COLORS.text, fontFamily: "'IBM Plex Sans',sans-serif", padding: 0, overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Filter bar: Deal selector (left) + statement filters (right) */}
      <div style={{ padding: "8px 32px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end", background: COLORS.headerBg, gap: 12 }}>
        <DealSelector selected={entity} onChange={handleEntityChange} onDealLoaded={setEntityNames} />
        {isPeriodTab && !dimensionsError && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <Select value={variant} onChange={setVariant} options={variantOptions} width={180} />
            {showQuarterSelect && <Select value={quarter} onChange={setQuarter} options={quarterOptions} width={120} />}
            {isStatementTab && <Select value={segment} onChange={setSegment} width={150} options={[
              { value: "all", label: "All Segments" },
              ...availableSegments.map((s) => ({ value: s, label: s })),
            ]} />}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", alignItems: "center", padding: "0 32px", background: COLORS.headerBg, borderBottom: `1px solid ${COLORS.border}` }}>
        <TabBar tabs={statementTabs} active={tab} onChange={handleTabChange} noBorder />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>

        {isStatementTab && (
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>

            {dimensionsError && (
              <div style={{ padding: "12px 16px", marginBottom: 16, background: "rgba(220,60,60,0.1)", border: "1px solid rgba(220,60,60,0.5)", borderRadius: 6, fontSize: 15, color: "#e55" }}>
                Failed to load report dimensions: {dimensionsError}. Report filters are unavailable.
              </div>
            )}

            {loading && <LoadingState message={`Loading ${tab === "pl" ? "Income Statement" : tab === "bs" ? "Balance Sheet" : "Cash Flow"}...`} />}

            {error && !loading && <ErrorState error={error} onRetry={loadReport} />}

            {!loading && !error && currentData && (
              <div style={{ background: COLORS.surface, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
                <div style={{ padding: "12px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>
                    {tab === "pl" ? "Income Statement" : tab === "bs" ? "Balance Sheet" : "Statement of Cash Flows"}
                  </span>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 13, padding: "3px 10px", background: "rgba(199,120,64,0.12)", color: COLORS.accent, borderRadius: 4, fontWeight: 600 }}>
                      {entityNames[entity] || (entity === "combined" ? "Combined" : entity)}
                    </span>
                    {currentData.metadata.periodType === "forecast" && (
                      <span style={{ fontSize: 15, padding: "3px 8px", background: "rgba(91,141,239,0.12)", color: COLORS.blue, borderRadius: 4, fontWeight: 600 }}>CONTAINS FORECAST</span>
                    )}
                    {segment !== "all" && (
                      <span style={{ fontSize: 15, padding: "3px 8px", background: "rgba(199,120,64,0.12)", color: COLORS.accent, borderRadius: 4, fontWeight: 600 }}>FILTERED: {segment}</span>
                    )}
                  </div>
                </div>
                <StatementTable data={currentData} pyData={pyData} showVariance={variant !== "quarterly"} entityId={entity} period={effectivePeriod} fsData={rawFSData} />
              </div>
            )}
          </div>
        )}

        {tab === "combining" && entity === "combined" && (
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
              <Select label="Report Variant" value={combiningVariant} onChange={setCombiningVariant} options={[
                { value: "act_vs_py", label: `FY${lastFullYear} Act vs FY${pyYear}` },
                { value: "q_act_vs_py", label: "Quarterly Act vs PY" },
                { value: "cf_vs_py", label: `FY${wallClockDate().getFullYear()} CF vs FY${lastFullYear}` },
                { value: "q_cf_vs_py", label: "Quarterly CF vs PY" },
              ]} width={220} />
              {(combiningVariant === "q_act_vs_py" || combiningVariant === "q_cf_vs_py") && (
                <Select label="Quarter" value={combiningQuarter} onChange={setCombiningQuarter} options={
                  combiningVariant === "q_cf_vs_py"
                    ? cfQuarters.map((q) => ({ value: q, label: q }))
                    : actQuarters.map((q) => ({ value: q, label: q }))
                } width={140} />
              )}
              <Select label="Segment" value={combiningSegment} onChange={setCombiningSegment} width={180} options={[
                { value: "all", label: "All Segments" },
                ...availableSegments.map((s) => ({ value: s, label: s })),
              ]} />
            </div>
            <CombiningStatement data={combiningData} loading={combiningLoading} error={combiningError} onRetry={loadCombining} />
          </div>
        )}
        {tab === "overlap" && entity === "combined" && (
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}><OverlapTab /></div>
        )}
        {tab === "crosssell" && entity === "combined" && (
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}><CrossSellTab /></div>
        )}
        {tab === "upsell" && entity === "combined" && (
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}><UpsellTab /></div>
        )}
        {tab === "pipeline" && <PipelineTab period={effectivePeriod} />}
        {tab === "whatif" && entity === "combined" && <WhatIfTab period={effectivePeriod} />}
        {tab === "qoe" && entity === "combined" && (
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}><QofETab /></div>
        )}

        {tab === "rev_by_customer" && entity !== "combined" && <RevenueByCustomerTab entityId={entity} />}
      </div>

    </div>
  );
}

export default ReportPortal;
