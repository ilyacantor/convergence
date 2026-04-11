"""Upload store — CRUD for file uploads (GL/CoA intake).

Sync psycopg2 layer matching engagement_store.py pattern.
"""

import json
import logging

import psycopg2
from psycopg2.extras import RealDictCursor

from backend.core.db import get_connection

logger = logging.getLogger(__name__)


def save_upload(
    tenant_id: str,
    entity_id: str,
    file_name: str,
    file_type: str,
    file_size: int,
    engagement_id: str | None = None,
    file_content: bytes | None = None,
) -> str:
    """Create an upload record. Returns upload_id."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO uploads
                    (tenant_id, engagement_id, entity_id, file_name, file_type,
                     file_size, file_content, status)
                VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, 'parsing')
                RETURNING upload_id
                """,
                (
                    tenant_id,
                    engagement_id,
                    entity_id,
                    file_name,
                    file_type,
                    file_size,
                    psycopg2.Binary(file_content) if file_content else None,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return str(row[0])


def get_upload(upload_id: str) -> dict | None:
    """Fetch a single upload by ID (without file_content)."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT upload_id, tenant_id, engagement_id, entity_id, file_name,
                       file_type, file_size, parse_result, status, created_at
                FROM uploads
                WHERE upload_id = %s::uuid
                """,
                (upload_id,),
            )
            r = cur.fetchone()
            if not r:
                return None
            parse_result = r["parse_result"]
            if isinstance(parse_result, str):
                parse_result = json.loads(parse_result)
            return {
                "upload_id": str(r["upload_id"]),
                "tenant_id": str(r["tenant_id"]),
                "engagement_id": str(r["engagement_id"]) if r["engagement_id"] else None,
                "entity_id": r["entity_id"],
                "file_name": r["file_name"],
                "file_type": r["file_type"],
                "file_size": r["file_size"],
                "parse_result": parse_result,
                "status": r["status"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }


def update_upload(upload_id: str, status: str, parse_result: dict | None = None) -> None:
    """Update upload status and optionally parse_result."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if parse_result is not None:
                cur.execute(
                    """
                    UPDATE uploads
                    SET status = %s, parse_result = %s::jsonb
                    WHERE upload_id = %s::uuid
                    """,
                    (status, json.dumps(parse_result), upload_id),
                )
            else:
                cur.execute(
                    "UPDATE uploads SET status = %s WHERE upload_id = %s::uuid",
                    (status, upload_id),
                )
            conn.commit()
