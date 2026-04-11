"""Upload routes — file upload, parsing, and triple conversion."""

import logging

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from backend.db import upload_store
from backend.services import parser

logger = logging.getLogger("convergence.upload")

router = APIRouter(prefix="/api/convergence/upload", tags=["upload"])


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    tenant_id: str = Form(...),
    entity_id: str = Form(...),
    engagement_id: str = Form(default=None),
):
    """Upload a CSV or Excel file for parsing."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    lower = file.filename.lower()
    if not lower.endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Unsupported file format. Expected CSV or Excel.")

    content = await file.read()
    file_size = len(content)

    file_type = parser.detect_file_type(file.filename)

    upload_id = upload_store.save_upload(
        tenant_id=tenant_id,
        entity_id=entity_id,
        file_name=file.filename,
        file_type=file_type,
        file_size=file_size,
        engagement_id=engagement_id,
        file_content=content,
    )

    try:
        if file_type == "coa":
            parse_result = parser.parse_coa(content, file.filename)
        else:
            parse_result = parser.parse_gl(content, file.filename)

        all_pass = all(v["pass"] for v in parse_result.get("validations", []))
        status = "parsed" if all_pass else "parsed_with_warnings"
        upload_store.update_upload(upload_id, status=status, parse_result=parse_result)
    except Exception as exc:
        logger.error(f"Parse failed for {file.filename}: {exc}")
        upload_store.update_upload(
            upload_id,
            status="error",
            parse_result={"error": str(exc)},
        )

    upload = upload_store.get_upload(upload_id)
    return upload


@router.get("/status/{upload_id}")
def get_upload_status(upload_id: str):
    """Get upload parse status and validation results."""
    upload = upload_store.get_upload(upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail=f"Upload {upload_id} not found")
    return upload


@router.post("/proceed/{upload_id}")
def proceed_upload(upload_id: str):
    """Trigger triple conversion after validation passes."""
    upload = upload_store.get_upload(upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail=f"Upload {upload_id} not found")

    if upload["status"] not in ("parsed", "parsed_with_warnings"):
        raise HTTPException(
            status_code=400,
            detail=f"Upload status is '{upload['status']}' — must be parsed before proceeding",
        )

    parse_result = upload.get("parse_result", {})
    entity_id = upload["entity_id"]
    conversion = parser.convert_to_triples(parse_result, entity_id)

    upload_store.update_upload(upload_id, status="converted")

    return {
        "upload_id": upload_id,
        "tenant_id": upload["tenant_id"],
        "entity_id": entity_id,
        "status": "converted",
        "conversion": conversion,
    }
