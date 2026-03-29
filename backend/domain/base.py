# FORKED from dcl/backend/domain/base.py on 2026-03-29
# Changes from DCL original: [none yet — initial fork]
# aos-common extraction planned post-carveout

"""
Base Pydantic models with camelCase serialization support.
"""

from pydantic import BaseModel, ConfigDict
from humps import camelize


def to_camel(string: str) -> str:
    """Convert snake_case to camelCase."""
    return camelize(string)


class CamelCaseModel(BaseModel):
    """
    Base model that serializes to camelCase for API responses.

    Usage:
        class MyModel(CamelCaseModel):
            my_field: str  # Serializes as "myField" in JSON
    """
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,  # Allow both snake_case and camelCase on input
        from_attributes=True,
    )
