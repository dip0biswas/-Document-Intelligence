from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import fitz
import pandas as pd
import pytesseract
from openpyxl.utils.exceptions import InvalidFileException
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from xlrd.biffh import XLRDError
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageSequence

logger = logging.getLogger("document-processor")
logging.basicConfig(level=logging.INFO)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 500
MAX_TIFF_FRAMES = 200
MAX_SHEETS = 100
MAX_SHEET_ROWS = 20_000
MAX_TABLE_CELLS = 10_000
MAX_CELL_CHARS = 200
MAX_IMAGE_PIXELS = 40_000_000
SUPPORTED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".xlsx", ".xls", ".csv"}
PROCESSING_API_URL = os.getenv("PROCESSING_API_URL", "http://localhost:4000/api").rstrip("/")
ProgressCallback = Callable[[str, int, int, str], None]

app = FastAPI(title="Document Processor", docs_url=None, redoc_url=None)


def _json_value(value: Any, warnings: list[str], sheet_name: str) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        warnings.append(f"Long cell values in '{sheet_name}' were shortened for safe storage.")
        return value[:MAX_CELL_CHARS]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    return value


def _table_result(name: str, frame: pd.DataFrame, warnings: list[str]) -> dict[str, Any]:
    frame = frame.iloc[:MAX_SHEET_ROWS, :100].copy()
    frame.columns = [str(column) for column in frame.columns]
    normalized = frame.astype(object).where(pd.notna(frame), None)
    rows = [
        {str(key): _json_value(value, warnings, name) for key, value in row.items()}
        for row in normalized.to_dict(orient="records")
    ]
    return {
        "name": name,
        "columns": list(frame.columns),
        "rowCount": len(rows),
        "rows": rows,
    }


def _spreadsheet(
    path: Path,
    extension: str,
    on_progress: ProgressCallback | None = None,
) -> tuple[str, list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    tables: list[dict[str, Any]] = []
    if extension == ".csv":
        if on_progress:
            on_progress("reading", 0, 1, "Reading CSV data")
        row_limit = MAX_TABLE_CELLS // 100
        columns = list(pd.read_csv(path, encoding="utf-8-sig", nrows=0).columns[:100])
        frame = (
            pd.read_csv(
                path,
                encoding="utf-8-sig",
                on_bad_lines="error",
                nrows=row_limit,
                usecols=columns,
            )
            if columns
            else pd.DataFrame()
        )
        tables = [_table_result("CSV", frame, warnings)]
        if on_progress:
            on_progress("reading", 1, 1, "CSV data read")
    else:
        if extension == ".xlsx":
            try:
                with zipfile.ZipFile(path) as archive:
                    members = archive.infolist()
                    uncompressed_size = sum(member.file_size for member in members)
                    if len(members) > 2_000 or uncompressed_size > 150 * 1024 * 1024:
                        raise HTTPException(status_code=413, detail="Spreadsheet archive exceeds safe processing limits.")
                    if any(member.file_size > 0 and member.compress_size == 0 for member in members):
                        raise HTTPException(status_code=422, detail="Spreadsheet archive is malformed.")
            except zipfile.BadZipFile as error:
                raise HTTPException(status_code=422, detail="XLSX file is corrupted or invalid.") from error
        with pd.ExcelFile(path, engine="openpyxl" if extension == ".xlsx" else "xlrd") as book:
            if len(book.sheet_names) > MAX_SHEETS:
                raise HTTPException(status_code=413, detail=f"Workbook exceeds the {MAX_SHEETS}-sheet limit.")
            if on_progress:
                on_progress("reading", 0, len(book.sheet_names), "Reading workbook sheets")
            cells_read = 0
            for sheet_index, sheet_name in enumerate(book.sheet_names, start=1):
                remaining_rows = min(MAX_SHEET_ROWS, (MAX_TABLE_CELLS - cells_read) // 100)
                if remaining_rows < 1:
                    warnings.append("Workbook was truncated at the total cell processing limit.")
                    break
                columns = list(pd.read_excel(book, sheet_name=sheet_name, nrows=0).columns[:100])
                frame = (
                    pd.read_excel(
                        book,
                        sheet_name=sheet_name,
                        nrows=remaining_rows,
                        usecols=columns,
                    )
                    if columns
                    else pd.DataFrame()
                )
                cells_read += frame.size
                if len(frame) == remaining_rows:
                    warnings.append(f"Sheet '{sheet_name}' was truncated to a safe processing limit.")
                tables.append(_table_result(sheet_name, frame, warnings))
                if on_progress:
                    on_progress("reading", sheet_index, len(book.sheet_names), f"Read sheet {sheet_index} of {len(book.sheet_names)}")

    cell_count = sum(len(table["columns"]) * table["rowCount"] for table in tables)
    if cell_count > MAX_TABLE_CELLS:
        raise HTTPException(status_code=413, detail="Spreadsheet exceeds the total cell processing limit.")
    text = "\n\n".join(
        f"Sheet/table: {table['name']}\nColumns: {', '.join(table['columns'])}\n"
        + "\n".join(
            " | ".join(f"{key}: {value if value is not None else ''}" for key, value in row.items())
            for row in table["rows"][:MAX_SHEET_ROWS]
        )
        for table in tables
    )
    return text[:200_000], tables, warnings


def _prepare_for_ocr(image: Image.Image) -> Image.Image:
    prepared = ImageOps.grayscale(image)
    prepared = ImageOps.autocontrast(prepared)
    if prepared.width < 1_500:
        scale = min(3.0, 1_500 / max(prepared.width, 1))
        prepared = prepared.resize((int(prepared.width * scale), int(prepared.height * scale)), Image.Resampling.LANCZOS)
    prepared = ImageEnhance.Contrast(prepared).enhance(1.25)
    return prepared.filter(ImageFilter.UnsharpMask(radius=1, percent=140, threshold=3))


def _ocr(image: Image.Image, warnings: list[str]) -> str:
    try:
        prepared = _prepare_for_ocr(image)
        data = pytesseract.image_to_data(prepared, config="--oem 3 --psm 6", output_type=pytesseract.Output.DICT)
        confidences: list[float] = []
        lines: list[str] = []
        current_line: tuple[int, int, int] | None = None
        words: list[str] = []
        for index, value in enumerate(data["conf"]):
            try:
                confidence = float(value)
            except (TypeError, ValueError):
                continue
            if confidence >= 0:
                confidences.append(confidence)
            word = data["text"][index].strip()
            if not word:
                continue
            line = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
            if current_line is not None and line != current_line:
                lines.append(" ".join(words))
                words = []
            current_line = line
            words.append(word)
        if words:
            lines.append(" ".join(words))
        if confidences and sum(confidences) / len(confidences) < 40:
            warnings.append("OCR confidence is low; verify extracted text manually.")
        return "\n".join(lines).strip()
    except pytesseract.TesseractNotFoundError as error:
        raise HTTPException(status_code=503, detail="Tesseract OCR is unavailable on the processing host.") from error


def _image_document(
    path: Path,
    extension: str,
    on_progress: ProgressCallback | None = None,
) -> tuple[str, int, list[str]]:
    warnings: list[str] = []
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Image dimensions exceed the safe OCR limit.")
            texts: list[str] = []
            frame_count = getattr(image, "n_frames", 1)
            if on_progress:
                on_progress("ocr", 0, frame_count, "Preparing image OCR")
            count = 0
            for frame in ImageSequence.Iterator(image):
                count += 1
                if count > MAX_TIFF_FRAMES:
                    raise HTTPException(status_code=413, detail=f"TIFF exceeds the {MAX_TIFF_FRAMES}-page limit.")
                if frame.width * frame.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(status_code=413, detail="Image dimensions exceed the safe OCR limit.")
                texts.append(f"[Page {count}]\n{_ocr(frame.copy(), warnings)}")
                if on_progress:
                    on_progress("ocr", count, frame_count, f"OCR page {count} of {frame_count}")
            return "\n\n".join(texts)[:200_000], count, warnings
    except (OSError, Image.DecompressionBombError) as error:
        raise HTTPException(status_code=422, detail=f"Image file is corrupted or invalid: {extension}") from error


def _pdf_document(
    path: Path,
    on_progress: ProgressCallback | None = None,
) -> tuple[str, int, list[str]]:
    warnings: list[str] = []
    try:
        with fitz.open(path) as pdf:
            if pdf.is_encrypted:
                raise HTTPException(status_code=422, detail="Password-protected PDFs cannot be processed.")
            if len(pdf) == 0:
                raise HTTPException(status_code=422, detail="PDF contains no pages.")
            if len(pdf) > MAX_PDF_PAGES:
                raise HTTPException(status_code=413, detail=f"PDF exceeds the {MAX_PDF_PAGES}-page limit.")
            pages: list[str] = []
            if on_progress:
                on_progress("reading", 0, len(pdf), "Reading PDF pages")
            for page_number, page in enumerate(pdf, start=1):
                text = page.get_text("text").strip()
                stage = "reading"
                label = f"Reading PDF page {page_number} of {len(pdf)}"
                if len(text) < 30:
                    if page.rect.width * page.rect.height * 6.25 > MAX_IMAGE_PIXELS:
                        raise HTTPException(status_code=413, detail=f"PDF page {page_number} exceeds the safe OCR dimensions.")
                    pixmap = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False)
                    image = Image.open(io.BytesIO(pixmap.tobytes("png")))
                    ocr_text = _ocr(image, warnings)
                    text = f"{text}\n{ocr_text}".strip()
                    stage = "ocr"
                    label = f"OCR page {page_number} of {len(pdf)}"
                pages.append(f"[Page {page_number}]\n{text}")
                if on_progress:
                    on_progress(stage, page_number, len(pdf), label)
            return "\n\n".join(pages)[:200_000], len(pdf), warnings
    except (fitz.FileDataError, fitz.EmptyFileError, RuntimeError, ValueError, OSError) as error:
        raise HTTPException(status_code=422, detail="PDF file is corrupted or invalid.") from error


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/process")
async def process_document(
    file: UploadFile = File(...),
    document_id: str = Form(...),
    processing_token: str = Form(...),
) -> dict[str, Any]:
    original_name = Path(file.filename or "document").name
    extension = Path(original_name).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported document extension: {extension or 'none'}")

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded file exceeds the 25 MiB processing limit.")

    temporary_path: Path | None = None
    last_progress_percent = 0
    last_progress_stage = ""

    def report_progress(stage: str, completed: int, total: int, label: str) -> None:
        nonlocal last_progress_percent, last_progress_stage
        percent = 10 + round(44 * completed / max(total, 1))
        if stage == last_progress_stage and percent < last_progress_percent + 2 and completed < total:
            return
        payload = json.dumps({
            "token": processing_token,
            "stage": stage,
            "label": label,
            "percent": min(percent, 54),
            "completedUnits": completed,
            "totalUnits": total,
        }).encode("utf-8")
        request = Request(
            f"{PROCESSING_API_URL}/documents/{document_id}/progress",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=3):
                pass
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            logger.warning("Unable to publish processing progress (%s).", type(error).__name__)
        last_progress_percent = percent
        last_progress_stage = stage

    try:
        with tempfile.NamedTemporaryFile(prefix="doc-", suffix=extension, delete=False) as temporary:
            temporary.write(content)
            temporary_path = Path(temporary.name)

        if extension in {".xlsx", ".xls", ".csv"}:
            text, tables, warnings = await asyncio.to_thread(_spreadsheet, temporary_path, extension, report_progress)
            page_count = len(tables)
        elif extension == ".pdf":
            if not content.startswith(b"%PDF-"):
                raise HTTPException(status_code=422, detail="PDF file signature is invalid.")
            text, page_count, warnings = await asyncio.to_thread(_pdf_document, temporary_path, report_progress)
            tables = []
        else:
            text, page_count, warnings = await asyncio.to_thread(_image_document, temporary_path, extension, report_progress)
            tables = []

        if not text.strip():
            warnings.append("No readable text was extracted from this document.")
        return {
            "filename": original_name,
            "text": text,
            "tables": tables,
            "page_count": page_count,
            "warnings": list(dict.fromkeys(warnings)),
        }
    except HTTPException:
        raise
    except (
        pd.errors.ParserError,
        UnicodeDecodeError,
        ValueError,
        OSError,
        zipfile.BadZipFile,
        InvalidFileException,
        XLRDError,
    ) as error:
        logger.info("Document could not be parsed: %s", type(error).__name__)
        raise HTTPException(status_code=422, detail="Document is corrupted, unsupported, or could not be parsed.") from error
    except Exception as error:
        logger.exception("Unexpected document processing failure")
        raise HTTPException(status_code=500, detail="Unexpected document processing failure.") from error
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                logger.exception("Unable to remove temporary processing file")
        await file.close()
