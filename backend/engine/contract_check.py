"""
AOS output contract check — validates an AOS tenant's triples
meet the Convergence consumption contract (convergence_transition_master §1).

Convergence owns this check. It runs inside POST /api/convergence/engagements
(engagement creation). Failures block engagement creation with per-domain diagnostics.
"""

import logging
from dataclasses import dataclass, field, asdict
from uuid import UUID

from backend.core.db import get_connection

logger = logging.getLogger(__name__)

REQUIRED_BUSINESS_RECORD_PROPERTIES = [
    "display_name",
    "normalized_name",
    "source_system",
    "source_record_id",
    "entity_id",
    "tenant_id",
]

IDENTIFIER_PRIORITY = {
    "customer": ["tax_id", "duns", "domain", "normalized_name"],
    "vendor": ["tax_id", "duns", "domain", "normalized_name"],
    "employee": ["email", "government_id", "normalized_name"],
    "coa": ["account_code", "normalized_name"],
    "product": ["sku", "normalized_name"],
    "it_asset": ["vendor_canonical_name", "normalized_name"],
}

DEFAULT_IDENTIFIER_THRESHOLD = 0.80


@dataclass
class DomainResult:
    domain: str
    namespace_type: str
    record_count: int
    property_coverage: dict[str, float]
    identifier_coverage: dict[str, float]
    issues: list[str]

    @property
    def passed(self) -> bool:
        return len(self.issues) == 0


@dataclass
class ContractResult:
    passed: bool
    tenant_id: str
    domains: list[DomainResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "tenant_id": self.tenant_id,
            "domains": [asdict(d) for d in self.domains],
        }


def _get_namespace_types(tenant_id: str) -> dict[str, str]:
    """Get namespace_type property for each domain in an AOS tenant's triples."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT split_part(concept, '.', 1) AS domain,
                       value #>> '{}'
                FROM semantic_triples
                WHERE tenant_id = %s::uuid
                  AND property = 'namespace_type'
                  AND is_active = true
                """,
                (tenant_id,),
            )
            return {row[0]: row[1] for row in cur.fetchall()}


def _get_domain_records(tenant_id: str, domain: str) -> dict[str, dict[str, str]]:
    """Get all concept records for a domain, grouped by concept with their properties."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT concept, property, value #>> '{}'
                FROM semantic_triples
                WHERE tenant_id = %s::uuid
                  AND split_part(concept, '.', 1) = %s
                  AND property != 'namespace_type'
                  AND is_active = true
                """,
                (tenant_id, domain),
            )
            records: dict[str, dict[str, str]] = {}
            for concept, prop, val in cur.fetchall():
                if concept not in records:
                    records[concept] = {}
                records[concept][prop] = val
            return records


def check_aos_contract(
    tenant_id: str | UUID,
    identifier_threshold: float = DEFAULT_IDENTIFIER_THRESHOLD,
) -> ContractResult:
    """Validate an AOS tenant's triples against the Convergence consumption contract.

    Per convergence_transition_master §1:
    - Every namespace has a namespace_type property
    - Every business_record namespace has required properties on every concept
    - Identifier coverage meets configurable threshold
    """
    tid = str(tenant_id)
    namespace_types = _get_namespace_types(tid)

    if not namespace_types:
        return ContractResult(
            passed=False,
            tenant_id=tid,
            domains=[DomainResult(
                domain="(none)",
                namespace_type="unknown",
                record_count=0,
                property_coverage={},
                identifier_coverage={},
                issues=[f"No namespaces found for tenant_id={tid}. "
                        "AOS pipeline may not have run or triples are missing namespace_type."],
            )],
        )

    domain_results: list[DomainResult] = []

    for domain, ns_type in sorted(namespace_types.items()):
        issues: list[str] = []

        if ns_type not in ("business_record", "financial_fact"):
            issues.append(
                f"namespace_type '{ns_type}' is not recognized. "
                f"Expected 'business_record' or 'financial_fact'."
            )
            domain_results.append(DomainResult(
                domain=domain,
                namespace_type=ns_type,
                record_count=0,
                property_coverage={},
                identifier_coverage={},
                issues=issues,
            ))
            continue

        if ns_type == "financial_fact":
            records = _get_domain_records(tid, domain)
            domain_results.append(DomainResult(
                domain=domain,
                namespace_type=ns_type,
                record_count=len(records),
                property_coverage={},
                identifier_coverage={},
                issues=[],
            ))
            continue

        records = _get_domain_records(tid, domain)
        record_count = len(records)

        if record_count == 0:
            issues.append(f"No records found in business_record namespace '{domain}'.")
            domain_results.append(DomainResult(
                domain=domain,
                namespace_type=ns_type,
                record_count=0,
                property_coverage={},
                identifier_coverage={},
                issues=issues,
            ))
            continue

        prop_coverage: dict[str, float] = {}
        for prop in REQUIRED_BUSINESS_RECORD_PROPERTIES:
            count = sum(1 for r in records.values() if r.get(prop))
            coverage = count / record_count
            prop_coverage[prop] = round(coverage, 3)
            if coverage < 1.0:
                issues.append(
                    f"Property '{prop}' only covers {count}/{record_count} records "
                    f"({coverage:.0%}). Required: 100%."
                )

        identifiers = IDENTIFIER_PRIORITY.get(domain, ["normalized_name"])
        id_coverage: dict[str, float] = {}
        max_id_coverage = 0.0
        for ident in identifiers:
            count = sum(1 for r in records.values() if r.get(ident))
            coverage = count / record_count
            id_coverage[ident] = round(coverage, 3)
            max_id_coverage = max(max_id_coverage, coverage)

        if max_id_coverage < identifier_threshold:
            issues.append(
                f"Identifier coverage below threshold. Best identifier coverage: "
                f"{max_id_coverage:.0%}, required: {identifier_threshold:.0%}. "
                f"Coverage per identifier: {id_coverage}"
            )

        domain_results.append(DomainResult(
            domain=domain,
            namespace_type=ns_type,
            record_count=record_count,
            property_coverage=prop_coverage,
            identifier_coverage=id_coverage,
            issues=issues,
        ))

    all_passed = all(d.passed for d in domain_results)
    return ContractResult(passed=all_passed, tenant_id=tid, domains=domain_results)
