# Generic Accounting Policy (Interim Fallback)

**Status:** interim fallback. Loaded when `backend/policies/{entity_id}_policy.md`
is not present. Industry-specific policy authoring is deferred — see
`convergence_deferred_work.md` (industry verticalization entry).

Values below reflect a standard US GAAP accrual-basis posture. `# WIP:`
markers flag slots that must be filled in by industry-specific authoring
or by Farm-sourced accounting_policy triples (whichever lands first).

## Accounting basis

- Reporting basis: accrual (ASC 606 revenue recognition, ASC 842 leases).
- Fiscal year: calendar year.
- Reporting currency: USD.
- Consolidation boundary: single-entity stand-alone financials unless the
  engagement explicitly combines.

## Revenue recognition

- Point-in-time vs over-time per performance obligation under ASC 606.
- `# WIP: sector-specific recognition patterns` (e.g. percent-complete for
  construction, subscription ratable for SaaS, point-of-sale for retail).
- Variable consideration estimated using expected-value or most-likely-amount
  method, constrained to amounts highly probable of not reversing.

## Expense classification

- Cost of goods / cost of services: direct labor, materials, delivery cost.
- Operating expenses: functional bucket by department (sales, marketing,
  G&A, R&D).
- Separately-stated lines: stock-based compensation, depreciation,
  amortization of intangibles.

## Asset treatment

- PP&E: straight-line depreciation over estimated useful life. Threshold for
  capitalization: ordinary fixed-asset threshold (`# WIP: company-specific
  dollar threshold`).
- Capitalized internal-use software (ASC 350-40) capitalized during
  application-development stage.
- Leases: ROU asset + lease liability recognized at commencement (ASC 842).

## Liability and accrual posture

- Accrue expenses when incurred, not when paid.
- Warranty / return reserves recognized when triggered.
- Contingent liabilities disclosed when reasonably possible, accrued when
  probable and estimable.

## Equity

- Stock-based compensation expensed over the requisite service period,
  fair-value measured at grant date.
- Treasury stock held at cost.

## Notes for consumers of this policy

This file is a fallback. Any conflict identified by COFA merge under this
policy should be flagged as *policy-generic* in the UI banner so the
operator can recognize that the reconciliation posture is not
entity-specific. The Convergence COFA merge response now carries
`policy_source: "generic"` when this file is in effect; the frontend
surfaces a non-blocking amber banner naming both entities in the engagement
whenever either entity is operating on the generic fallback.
