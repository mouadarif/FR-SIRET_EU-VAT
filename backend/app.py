from __future__ import annotations

import csv
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask


APP_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = APP_ROOT / "enrich_by_siret.py"
COL_SIRET = "FR_SIRET"
DEFAULT_TIMEOUT_SEC = 900
DEFAULT_VIES_TIMEOUT_SEC = 30
VIES_BASE_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api"
SUPPORTED_EXTENSIONS = {".csv", ".tsv", ".xlsx", ".xlsm"}

app = FastAPI(title="INSEE and VIES Enrichment API")


def _timeout_seconds() -> int:
    raw = os.environ.get("SIRET_ENRICH_TIMEOUT_SEC", str(DEFAULT_TIMEOUT_SEC))
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_TIMEOUT_SEC


def _workers() -> str:
    raw = os.environ.get("INSEE_MAX_WORKERS", "8")
    try:
        return str(max(1, int(raw)))
    except ValueError:
        return "8"


def _vies_timeout_seconds() -> int:
    raw = os.environ.get("VIES_TIMEOUT_SEC", str(DEFAULT_VIES_TIMEOUT_SEC))
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_VIES_TIMEOUT_SEC


def _safe_suffix(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload CSV, TSV, XLSX, or XLSM.",
        )
    return suffix


def _read_uploaded_table(path: Path, suffix: str) -> pd.DataFrame:
    if suffix == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            sample = handle.read(4096)
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
        return pd.read_csv(path, sep=delimiter, dtype=str, encoding="utf-8-sig")
    if suffix == ".tsv":
        return pd.read_csv(path, sep="\t", dtype=str)
    return pd.read_excel(path, engine="openpyxl", dtype=str)


def _prepare_workbook(input_path: Path, suffix: str, siret_column: str, output_path: Path) -> int:
    df = _read_uploaded_table(input_path, suffix)
    if siret_column not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"SIRET column {siret_column!r} was not found in the uploaded file.",
        )

    prepared = df.copy()
    if siret_column != COL_SIRET:
        prepared[COL_SIRET] = prepared[siret_column]

    prepared.to_excel(output_path, index=False, engine="openpyxl")
    return len(prepared)


def _normalize_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def _normalize_vat(value: Any) -> str:
    return "".join(_normalize_text(value).upper().split())


def _normalize_country_code(value: Any) -> str:
    letters = "".join(ch for ch in _normalize_text(value).upper() if "A" <= ch <= "Z")
    return letters[:2]


def _split_vat_identifier(raw_vat: Any, raw_country_code: Any = "") -> dict[str, str]:
    vat = _normalize_vat(raw_vat)
    country_code = _normalize_country_code(raw_country_code)

    if country_code:
        vat_number = vat[len(country_code):] if vat.startswith(country_code) else vat
        return {
            "country_code": country_code,
            "vat_number": vat_number,
            "display_vat": f"{country_code}{vat_number}",
            "raw_vat": vat,
        }

    if len(vat) > 2 and vat[:2].isalpha():
        return {
            "country_code": vat[:2],
            "vat_number": vat[2:],
            "display_vat": vat,
            "raw_vat": vat,
        }

    return {
        "country_code": "",
        "vat_number": vat,
        "display_vat": vat,
        "raw_vat": vat,
    }


def _first_present(*values: Any) -> str:
    for value in values:
        text = _normalize_text(value)
        if text:
            return text
    return ""


def _to_yes_no(value: Any) -> str:
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text = _normalize_text(value).lower()
    if text in {"true", "valid", "yes", "1"}:
        return "Yes"
    return "No"


def _flatten_json(obj: Any, prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            next_prefix = f"{prefix}_{key}" if prefix else str(key)
            out.update(_flatten_json(value, next_prefix))
        return out
    if isinstance(obj, list):
        for index, value in enumerate(obj):
            next_prefix = f"{prefix}_{index}" if prefix else str(index)
            out.update(_flatten_json(value, next_prefix))
        return out
    if prefix:
        out[prefix] = obj
    return out


def _safe_excel_value(value: Any) -> Any:
    if value is None or pd.isna(value):
        return ""
    if isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _vies_base_output(row: dict[str, Any], lookup: dict[str, str]) -> dict[str, Any]:
    return {
        **row,
        "VIES_Source_VAT": lookup["raw_vat"],
        "VIES_Source_Country_Code": lookup["country_code"],
        "VIES_Normalized_VAT": lookup["display_vat"],
    }


def _vies_error_row(row: dict[str, Any], lookup: dict[str, str], status: str, message: str) -> dict[str, Any]:
    return {
        **_vies_base_output(row, lookup),
        "VIES_Status": status,
        "VIES_Is_Valid": "No",
        "VIES_User_Error": message,
        "VIES_Name": "",
        "VIES_Legal_Name": "",
        "VIES_Address": "",
        "VIES_Registered_Address": "",
        "VIES_Request_Date": "",
        "VIES_Request_Identifier": "",
        "VIES_Country_Code": lookup["country_code"],
        "VIES_VAT_Number": lookup["vat_number"],
        "VIES_Original_VAT_Number": lookup["display_vat"],
        "VIES_Error_Message": message,
    }


def _vies_validated_row(row: dict[str, Any], lookup: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    legal_name = _first_present(
        payload.get("name"),
        payload.get("legalName"),
        payload.get("legal_name"),
        payload.get("traderName"),
        payload.get("trader_name"),
        payload.get("companyName"),
        payload.get("company_name"),
    )
    registered_address = _first_present(
        payload.get("address"),
        payload.get("registeredAddress"),
        payload.get("registered_address"),
        payload.get("legalAddress"),
        payload.get("legal_address"),
        payload.get("traderAddress"),
        payload.get("trader_address"),
        payload.get("companyAddress"),
        payload.get("company_address"),
    )
    is_valid = payload.get("isValid", payload.get("valid", payload.get("is_valid", False)))
    user_error = _first_present(payload.get("userError"), payload.get("user_error"))
    raw_fields = {
        f"VIES_Raw_{key}": _safe_excel_value(value)
        for key, value in _flatten_json(payload).items()
    }

    return {
        **_vies_base_output(row, lookup),
        "VIES_Status": user_error or ("VALID" if bool(is_valid) else "INVALID"),
        "VIES_Is_Valid": _to_yes_no(is_valid),
        "VIES_User_Error": user_error,
        "VIES_Name": legal_name,
        "VIES_Legal_Name": legal_name,
        "VIES_Address": registered_address,
        "VIES_Registered_Address": registered_address,
        "VIES_Request_Date": _first_present(payload.get("requestDate"), payload.get("request_date")),
        "VIES_Request_Identifier": _first_present(
            payload.get("requestIdentifier"),
            payload.get("request_identifier"),
        ),
        "VIES_Country_Code": _first_present(payload.get("countryCode"), payload.get("country_code"), lookup["country_code"]),
        "VIES_VAT_Number": _first_present(payload.get("vatNumber"), payload.get("vat_number"), lookup["vat_number"]),
        "VIES_Original_VAT_Number": _first_present(
            payload.get("originalVatNumber"),
            payload.get("original_vat_number"),
            lookup["display_vat"],
        ),
        "VIES_Error_Message": "",
        **raw_fields,
    }


def _fetch_vies(lookup: dict[str, str]) -> dict[str, Any]:
    url = f"{VIES_BASE_URL}/ms/{lookup['country_code']}/vat/{lookup['vat_number']}"
    response = requests.get(url, headers={"Accept": "application/json"}, timeout=_vies_timeout_seconds())
    if response.status_code >= 400:
        detail = response.text[:500] or response.reason or "VIES request failed."
        raise RuntimeError(f"HTTP {response.status_code}: {detail}")
    return response.json()


def _write_vies_workbook(
    input_path: Path,
    suffix: str,
    vat_column: str,
    country_column: str,
    output_path: Path,
) -> int:
    df = _read_uploaded_table(input_path, suffix)
    if vat_column not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"VAT column {vat_column!r} was not found in the uploaded file.",
        )
    if country_column and country_column not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"Country column {country_column!r} was not found in the uploaded file.",
        )

    output_rows: list[dict[str, Any]] = []
    for _, source_row in df.iterrows():
        row = {key: _safe_excel_value(value) for key, value in source_row.to_dict().items()}
        lookup = _split_vat_identifier(row.get(vat_column), row.get(country_column) if country_column else "")

        if not lookup["raw_vat"]:
            output_rows.append(_vies_error_row(row, lookup, "MISSING_VAT", "VAT number missing from mapped field."))
            continue
        if not lookup["country_code"] or not lookup["vat_number"]:
            output_rows.append(_vies_error_row(row, lookup, "INVALID_INPUT", "VAT must include a country code or mapped country column."))
            continue

        try:
            output_rows.append(_vies_validated_row(row, lookup, _fetch_vies(lookup)))
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            output_rows.append(_vies_error_row(row, lookup, "ERROR", str(exc)))

    pd.DataFrame(output_rows).to_excel(output_path, index=False, engine="openpyxl")
    return len(output_rows)


def _cleanup_temp_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/enrich-by-siret")
async def enrich_by_siret(
    file: UploadFile = File(...),
    siret_column: str = Form(...),
) -> FileResponse:
    suffix = _safe_suffix(file.filename or "")
    selected_column = siret_column.strip()
    if not selected_column:
        raise HTTPException(status_code=400, detail="Select the SIRET column before enrichment.")

    temp_dir = Path(tempfile.mkdtemp(prefix="insee_siret_"))
    upload_path = temp_dir / f"input{suffix}"
    prepared_path = temp_dir / "prepared.xlsx"
    output_path = temp_dir / "enriched_by_siret.xlsx"

    try:
        with upload_path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                handle.write(chunk)

        row_count = _prepare_workbook(upload_path, suffix, selected_column, prepared_path)

        command = [
            sys.executable,
            str(SCRIPT_PATH),
            str(prepared_path),
            "--output",
            str(output_path),
            "--workers",
            _workers(),
        ]

        completed = subprocess.run(
            command,
            cwd=str(APP_ROOT),
            text=True,
            capture_output=True,
            timeout=_timeout_seconds(),
            check=False,
        )

        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "SIRET enrichment failed.").strip()
            with open("backend_subprocess_error.log", "w", encoding="utf-8") as f:
                f.write(detail)
            raise HTTPException(status_code=500, detail=detail[-1200:])

        if not output_path.is_file():
            raise HTTPException(status_code=500, detail="SIRET enrichment did not produce an output workbook.")

        headers = {
            "X-Enriched-Filename": "enriched_by_siret.xlsx",
            "X-Input-Rows": str(row_count),
        }
        return FileResponse(
            output_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename="enriched_by_siret.xlsx",
            headers=headers,
            background=BackgroundTask(_cleanup_temp_dir, temp_dir),
        )
    except HTTPException:
        _cleanup_temp_dir(temp_dir)
        raise
    except subprocess.TimeoutExpired as exc:
        _cleanup_temp_dir(temp_dir)
        raise HTTPException(
            status_code=504,
            detail=f"SIRET enrichment timed out after {_timeout_seconds()} seconds.",
        ) from exc
    except Exception as exc:
        _cleanup_temp_dir(temp_dir)
        import traceback
        with open("backend_error.log", "w") as f:
            f.write(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/enrich-by-vat")
async def enrich_by_vat(
    file: UploadFile = File(...),
    vat_column: str = Form(...),
    country_column: str = Form(""),
) -> FileResponse:
    suffix = _safe_suffix(file.filename or "")
    selected_vat_column = vat_column.strip()
    selected_country_column = country_column.strip()
    if not selected_vat_column:
        raise HTTPException(status_code=400, detail="Select the VAT column before enrichment.")

    temp_dir = Path(tempfile.mkdtemp(prefix="vies_vat_"))
    upload_path = temp_dir / f"input{suffix}"
    output_path = temp_dir / "enriched_by_vat.xlsx"

    try:
        with upload_path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                handle.write(chunk)

        row_count = _write_vies_workbook(
            upload_path,
            suffix,
            selected_vat_column,
            selected_country_column,
            output_path,
        )

        if not output_path.is_file():
            raise HTTPException(status_code=500, detail="VIES enrichment did not produce an output workbook.")

        headers = {
            "X-Enriched-Filename": "enriched_by_vat.xlsx",
            "X-Input-Rows": str(row_count),
        }
        return FileResponse(
            output_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename="enriched_by_vat.xlsx",
            headers=headers,
            background=BackgroundTask(_cleanup_temp_dir, temp_dir),
        )
    except HTTPException:
        _cleanup_temp_dir(temp_dir)
        raise
    except Exception as exc:
        _cleanup_temp_dir(temp_dir)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
