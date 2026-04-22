"""Canonical entity_id shape.

Single source of truth for the Convergence entity_id regex.
Every site that validates entity_id shape imports from here — no
regex copies. Shape example: BlueLogic-NEQ8, InfoSystems-1KKQ.

Rules:
- First char capital letter.
- Name segment PascalCase (letters only).
- Dash.
- Suffix 2-6 chars, alphanumeric (digits and uppercase letters).
- No underscores. No spaces. No UUIDs.
"""
import re

ENTITY_ID_PATTERN = r"^[A-Z][a-zA-Z]+-[A-Z0-9]{2,6}$"
_ENTITY_ID_RE = re.compile(ENTITY_ID_PATTERN)


def is_valid_entity_id(value: object) -> bool:
    """True if value is a string matching ENTITY_ID_PATTERN."""
    return isinstance(value, str) and bool(_ENTITY_ID_RE.match(value))


def validate_entity_id(value: object, field_name: str = "entity_id") -> str:
    """Return the value if shape-compliant, else raise ValueError.

    The error message names the field and the offending value so 422
    responses stay self-describing.
    """
    if not is_valid_entity_id(value):
        raise ValueError(
            f"{field_name!r} must match {ENTITY_ID_PATTERN} "
            f"(e.g. BlueLogic-NEQ8). Got: {value!r}"
        )
    return value  # type: ignore[return-value]
