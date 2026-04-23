"""
Engagement configuration loader.

Provides the active engagement config to all engines. Every engine reads
entity IDs, display names, and deal parameters from this config — never
from hardcoded strings.

Loads from the canonical engagements table in Convergence's DB.
"""

import os
from dataclasses import dataclass

from backend.utils.log_utils import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class EngagementEntity:
    """One side of the M&A engagement."""
    id: str              # shape-compliant entity_id (e.g. "BlueLogic-NEQ8")
    display_name: str    # human-readable entity name (e.g. "Blue Logic Partners")
    role: str            # "acquirer" or "target"
    business_model: str  # "consultancy", "bpm", "saas"
    source_systems: dict  # {"crm": "salesforce_crm", ...}


@dataclass(frozen=True)
class EngagementConfig:
    """Full engagement configuration."""
    engagement_id: str
    deal_name: str
    entity_a: EngagementEntity
    entity_b: EngagementEntity
    deal_parameters: dict
    synergy_targets: dict

    def entity_ids(self) -> tuple[str, str]:
        """Return (entity_a_id, entity_b_id)."""
        return self.entity_a.id, self.entity_b.id

    def entity_by_id(self, entity_id: str) -> EngagementEntity:
        """Look up an entity by ID.  Raises ValueError if not found."""
        if entity_id == self.entity_a.id:
            return self.entity_a
        if entity_id == self.entity_b.id:
            return self.entity_b
        raise ValueError(
            f"Entity '{entity_id}' not in engagement {self.engagement_id}. "
            f"Known entities: {self.entity_a.id}, {self.entity_b.id}"
        )

    def a_to_b_label(self) -> str:
        """Direction label: 'entity_a → entity_b'."""
        return f"{self.entity_a.display_name} → {self.entity_b.display_name}"

    def b_to_a_label(self) -> str:
        """Direction label: 'entity_b → entity_a'."""
        return f"{self.entity_b.display_name} → {self.entity_a.display_name}"

    @property
    def short_name(self) -> str:
        """ME engagement short name — first 3 chars of each entity display name.

        Example: "Blue Logic Partners" + "Info Systems" -> BluInf
        Used in run_name generation per I5.
        """
        a_prefix = self.entity_a.display_name[:3]
        b_prefix = self.entity_b.display_name[:3]
        return f"{a_prefix}{b_prefix}"


# Module-level singleton — loaded once, reused.
# Module-level engagement cache removed — see get_active_engagement.


def _build_config(row: dict) -> EngagementConfig:
    """Build EngagementConfig from a DB engagement row dict."""
    state = row.get("state", {})
    return EngagementConfig(
        engagement_id=row["engagement_id"],
        deal_name=state.get("deal_name", ""),
        entity_a=EngagementEntity(
            id=row["acquirer_entity_id"],
            display_name=state.get("entity_a_name", row["acquirer_entity_id"]),
            role="acquirer",
            business_model=state.get("entity_a_business_model", "unknown"),
            source_systems=state.get("entity_a_source_systems", {}),
        ),
        entity_b=EngagementEntity(
            id=row["target_entity_id"],
            display_name=state.get("entity_b_name", row["target_entity_id"]),
            role="target",
            business_model=state.get("entity_b_business_model", "unknown"),
            source_systems=state.get("entity_b_source_systems", {}),
        ),
        deal_parameters=state.get("deal_parameters", {}),
        synergy_targets=state.get("synergy_targets", {}),
    )


def get_active_engagement(tenant_id: str | None = None) -> EngagementConfig:
    """Load and return the active engagement config (uncached).

    The previous in-process cache held the first resolved engagement
    forever and never invalidated on create / update / promote. That
    masked lifecycle changes — a newly promoted engagement wouldn't be
    picked up until the backend restarted. The SELECT that backs this
    is cheap (ORDER BY updated_at DESC LIMIT 1) so uncached is
    correct.

    tenant_id: if not provided, reads AOS_TENANT_ID from env.
    Raises RuntimeError if no tenant_id available or no active
    engagement found.
    """
    from backend.db import engagement_store

    if not tenant_id:
        tenant_id = os.environ.get("AOS_TENANT_ID")
    if not tenant_id:
        raise RuntimeError(
            "Cannot load active engagement: no tenant_id provided and "
            "AOS_TENANT_ID not set in environment."
        )

    row = engagement_store.get_active_engagement(tenant_id)
    if not row:
        raise RuntimeError(
            f"No active engagement found for tenant_id={tenant_id}. "
            f"Create an engagement and set lifecycle_stage='active'."
        )

    return _build_config(row)


def invalidate_engagement() -> None:
    """Legacy no-op — get_active_engagement is uncached.

    Kept for backwards-compatible imports; safe to remove once
    no call sites remain.
    """
    return None
