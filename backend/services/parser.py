"""GL and CoA file parser — CSV and Excel support."""

import io
import logging
import re
from typing import Any

import pandas as pd

logger = logging.getLogger("convergence.parser")

# Column detection patterns
_ACCOUNT_NUM_PATTERNS = [
    r"account.?num", r"acct.?num", r"acct.?no", r"account.?id", r"acct.?id",
    r"account.?code", r"acct.?code", r"^acct$", r"^account$",
]
_ACCOUNT_NAME_PATTERNS = [
    r"account.?name", r"acct.?name", r"description", r"account.?desc",
]
_PERIOD_PATTERNS = [
    r"period", r"date", r"month", r"quarter", r"fiscal", r"year.?month",
]
_DEBIT_PATTERNS = [r"debit", r"^dr$", r"debit.?amount"]
_CREDIT_PATTERNS = [r"credit", r"^cr$", r"credit.?amount"]
_NET_PATTERNS = [r"net.?amount", r"amount", r"balance", r"net"]
_ACCOUNT_TYPE_PATTERNS = [r"account.?type", r"acct.?type", r"type", r"category"]
_HIERARCHY_PATTERNS = [r"level", r"hierarchy", r"depth", r"parent"]


def _match_column(columns: list[str], patterns: list[str]) -> str | None:
    """Find the first column matching any of the patterns (case-insensitive)."""
    for col in columns:
        col_lower = col.strip().lower()
        for pat in patterns:
            if re.search(pat, col_lower):
                return col
    return None


def _read_file(content: bytes, file_name: str) -> pd.DataFrame:
    """Read CSV or Excel file content into a DataFrame."""
    lower = file_name.lower()
    if lower.endswith(".csv"):
        return pd.read_csv(io.BytesIO(content))
    if lower.endswith((".xlsx", ".xls")):
        return pd.read_excel(io.BytesIO(content), engine="openpyxl")
    raise ValueError(f"Unsupported file format: {file_name}. Expected CSV or Excel.")


def parse_gl(content: bytes, file_name: str) -> dict[str, Any]:
    """Parse a General Ledger file. Returns structured parse result."""
    df = _read_file(content, file_name)
    cols = list(df.columns)

    acct_num_col = _match_column(cols, _ACCOUNT_NUM_PATTERNS)
    acct_name_col = _match_column(cols, _ACCOUNT_NAME_PATTERNS)
    period_col = _match_column(cols, _PERIOD_PATTERNS)
    debit_col = _match_column(cols, _DEBIT_PATTERNS)
    credit_col = _match_column(cols, _CREDIT_PATTERNS)
    net_col = _match_column(cols, _NET_PATTERNS)

    has_separate_dr_cr = debit_col is not None and credit_col is not None
    has_net = net_col is not None and not has_separate_dr_cr
    fmt = "separate_dr_cr" if has_separate_dr_cr else "net_amount" if has_net else "unknown"

    validations = []

    # Check account numbers
    unique_accounts = 0
    if acct_num_col:
        unique_accounts = int(df[acct_num_col].nunique())
        validations.append({"check": "Account numbers present", "pass": True, "detail": f"{unique_accounts} unique"})
    else:
        validations.append({"check": "Account numbers present", "pass": False, "detail": "No account number column detected"})

    # Check period
    unique_periods = 0
    period_type = "Unknown"
    if period_col:
        unique_periods = int(df[period_col].nunique())
        period_type = "Monthly" if unique_periods > 4 else "Quarterly"
        validations.append({"check": "Period column detected", "pass": True, "detail": f"{period_type}, {unique_periods} periods"})
    else:
        validations.append({"check": "Period column detected", "pass": False, "detail": "No period column detected"})

    # Check debit/credit
    if has_separate_dr_cr:
        validations.append({"check": "Debit/credit columns", "pass": True, "detail": "Separate columns"})
    elif has_net:
        validations.append({"check": "Debit/credit columns", "pass": True, "detail": "Net amount"})
    else:
        validations.append({"check": "Debit/credit columns", "pass": False, "detail": "No debit/credit or net amount column detected"})

    # Trial balance check
    variance = 0.0
    tb_pass = False
    if has_separate_dr_cr:
        total_dr = pd.to_numeric(df[debit_col], errors="coerce").fillna(0).sum()
        total_cr = pd.to_numeric(df[credit_col], errors="coerce").fillna(0).sum()
        variance = round(abs(float(total_dr) - float(total_cr)), 2)
        tb_pass = variance < 0.01
    elif has_net:
        total_net = pd.to_numeric(df[net_col], errors="coerce").fillna(0).sum()
        variance = round(abs(float(total_net)), 2)
        tb_pass = variance < 0.01
    validations.append({
        "check": "Trial balance nets to zero",
        "pass": tb_pass,
        "detail": f"${variance:,.2f} variance" if (has_separate_dr_cr or has_net) else "Cannot check — no amount columns",
    })

    return {
        "file_name": file_name,
        "file_type": "gl",
        "rows": len(df),
        "accounts": unique_accounts,
        "periods": unique_periods,
        "format": fmt,
        "validations": validations,
        "columns_detected": {
            "account_number": acct_num_col,
            "account_name": acct_name_col,
            "period": period_col,
            "debit": debit_col,
            "credit": credit_col,
            "net_amount": net_col if has_net else None,
        },
    }


def parse_coa(content: bytes, file_name: str) -> dict[str, Any]:
    """Parse a Chart of Accounts file. Returns structured parse result."""
    df = _read_file(content, file_name)
    cols = list(df.columns)

    acct_num_col = _match_column(cols, _ACCOUNT_NUM_PATTERNS)
    acct_name_col = _match_column(cols, _ACCOUNT_NAME_PATTERNS)
    acct_type_col = _match_column(cols, _ACCOUNT_TYPE_PATTERNS)
    hierarchy_col = _match_column(cols, _HIERARCHY_PATTERNS)

    validations = []
    unique_accounts = 0

    if acct_num_col:
        unique_accounts = int(df[acct_num_col].nunique())
        validations.append({"check": "Account numbers present", "pass": True, "detail": f"{unique_accounts} unique"})
    else:
        validations.append({"check": "Account numbers present", "pass": False, "detail": "No account number column detected"})

    if acct_name_col:
        validations.append({"check": "Account names present", "pass": True, "detail": acct_name_col})
    else:
        validations.append({"check": "Account names present", "pass": False, "detail": "No account name column detected"})

    if acct_type_col:
        validations.append({"check": "Account type column", "pass": True, "detail": acct_type_col})
    else:
        validations.append({"check": "Account type column", "pass": False, "detail": "Not detected"})

    hierarchy_levels = 0
    if hierarchy_col:
        hierarchy_levels = int(df[hierarchy_col].nunique())
        validations.append({"check": "Hierarchy detected", "pass": True, "detail": f"{hierarchy_levels} levels"})
    else:
        validations.append({"check": "Hierarchy detected", "pass": False, "detail": "Will derive from GL"})

    return {
        "file_name": file_name,
        "file_type": "coa",
        "rows": len(df),
        "accounts": unique_accounts,
        "hierarchy_levels": hierarchy_levels,
        "validations": validations,
        "columns_detected": {
            "account_number": acct_num_col,
            "account_name": acct_name_col,
            "account_type": acct_type_col,
            "hierarchy": hierarchy_col,
        },
    }


def detect_file_type(file_name: str) -> str:
    """Guess whether a file is GL or CoA based on name."""
    lower = file_name.lower()
    if "coa" in lower or "chart" in lower:
        return "coa"
    return "gl"


def convert_to_triples(parse_result: dict[str, Any], entity_id: str) -> dict[str, Any]:
    """Stub: convert parsed GL data to triple format.

    In Phase 4 this logs what would happen but does not actually push to PG.
    Real triple conversion is future hardening work.
    """
    rows = parse_result.get("rows", 0)
    accounts = parse_result.get("accounts", 0)
    logger.info(
        f"Triple conversion stub: would convert {rows} rows, "
        f"{accounts} accounts for entity={entity_id}"
    )
    return {
        "status": "conversion_complete",
        "entity_id": entity_id,
        "triples_estimated": rows,
        "accounts": accounts,
        "note": "Stub — triple push not implemented in Phase 4",
    }
