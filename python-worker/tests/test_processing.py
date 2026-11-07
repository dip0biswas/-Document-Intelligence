import tempfile
import unittest
from pathlib import Path
import shutil

import fitz
import pandas as pd
from fastapi import HTTPException
from PIL import Image, ImageDraw

from app.main import _image_document, _pdf_document, _spreadsheet


class SpreadsheetProcessingTests(unittest.TestCase):
    def test_csv_returns_structured_rows_and_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "invoices.csv"
            pd.DataFrame([{"Invoice": "INV-1", "Total": 20.5}]).to_csv(file_path, index=False)
            text, tables, warnings = _spreadsheet(file_path, ".csv")

        self.assertIn("INV-1", text)
        self.assertEqual(tables[0]["name"], "CSV")
        self.assertEqual(tables[0]["rows"][0]["Total"], 20.5)
        self.assertEqual(warnings, [])

    def test_xlsx_extracts_multiple_sheets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "invoices.xlsx"
            with pd.ExcelWriter(file_path) as writer:
                pd.DataFrame([{"Invoice": "INV-1"}]).to_excel(writer, sheet_name="January", index=False)
                pd.DataFrame([{"Invoice": "INV-2"}]).to_excel(writer, sheet_name="February", index=False)
            text, tables, _ = _spreadsheet(file_path, ".xlsx")

        self.assertIn("January", text)
        self.assertEqual([table["name"] for table in tables], ["January", "February"])
        self.assertEqual(tables[1]["rows"][0]["Invoice"], "INV-2")

    def test_corrupted_xlsx_is_a_client_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "broken.xlsx"
            file_path.write_bytes(b"not a workbook")
            with self.assertRaises(HTTPException) as raised:
                _spreadsheet(file_path, ".xlsx")

        self.assertEqual(raised.exception.status_code, 422)


class PdfProcessingTests(unittest.TestCase):
    def test_digital_multi_page_pdf_extracts_each_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "invoice.pdf"
            document = fitz.open()
            for page_number in range(1, 3):
                page = document.new_page()
                page.insert_text((72, 72), f"Invoice page {page_number} with readable digital text and enough characters to avoid OCR.")
            document.save(file_path)
            document.close()
            text, page_count, warnings = _pdf_document(file_path)

        self.assertEqual(page_count, 2)
        self.assertIn("[Page 1]", text)
        self.assertIn("[Page 2]", text)
        self.assertEqual(warnings, [])

    def test_digital_pdf_reports_page_progress(self) -> None:
        progress: list[tuple[str, int, int, str]] = []
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "invoice.pdf"
            document = fitz.open()
            for page_number in range(1, 4):
                page = document.new_page()
                page.insert_text((72, 72), f"Invoice page {page_number} with readable digital text and enough characters to avoid OCR.")
            document.save(file_path)
            document.close()
            _pdf_document(file_path, lambda *update: progress.append(update))

        self.assertEqual(progress[0], ("reading", 0, 3, "Reading PDF pages"))
        self.assertEqual(progress[-1][1:], (3, 3, "Reading PDF page 3 of 3"))


@unittest.skipUnless(shutil.which("tesseract"), "Tesseract is not installed")
class OcrProcessingTests(unittest.TestCase):
    def test_scanned_image_text_is_extracted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "scan.png"
            image = Image.new("RGB", (450, 140), "white")
            ImageDraw.Draw(image).text((20, 45), "INVOICE 12345 TOTAL 128.50", fill="black")
            image.save(file_path)
            text, frame_count, _ = _image_document(file_path, ".png")

        self.assertEqual(frame_count, 1)
        self.assertIn("INVOICE", text.upper())
        self.assertIn("TOTAL", text.upper())


if __name__ == "__main__":
    unittest.main()
