"""Generic textbook ingestion pipeline.

Usage:
  python3 scripts/ingest_book.py --pdf book.pdf --pages-dir DIR --out extraction.json [--catalog catalog.json]

Requires PyMuPDF (`pip install pymupdf`). Output JSON is consumed by the Node
indexing worker (pnpm worker:index); page images go to the DATA_DIR pages folder,
never to the public web root. Keeps the proven strengths of the original
pipeline: page-level text, page images for math fidelity, equation candidates,
and printed page numbers only when reliably detected.
"""
import argparse
import hashlib
import json
import pathlib
import re
import unicodedata

import fitz


def clean(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"[\u0610-\u061a\u064b-\u065f\u0670\u200e\u200f\u202a-\u202e\u0640\ufffd]", "", value)
    return re.sub(r"[ \t]+", " ", value).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--pages-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--catalog", help="optional JSON [[pdfStartPage, unit, lesson], ...]")
    parser.add_argument("--min-chars", type=int, default=10)
    args = parser.parse_args()

    pdf_path = pathlib.Path(args.pdf)
    document = fitz.open(pdf_path)
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    source = "book-" + sha[:12]

    catalog = []
    if args.catalog:
        catalog = json.loads(pathlib.Path(args.catalog).read_text())

    pages_dir = pathlib.Path(args.pages_dir)
    pages_dir.mkdir(parents=True, exist_ok=True)

    records = []
    for index, page in enumerate(document):
        page_number = index + 1
        text = clean(page.get_text(sort=False))
        if len(text) < args.min_chars:
            continue

        title = next((entry for entry in reversed(catalog) if page_number >= entry[0]), None) if catalog else None
        unit = title[1] if title else None
        lesson = title[2] if title else None

        footer = page.get_text(clip=fitz.Rect(0, page.rect.height - 50, page.rect.width, page.rect.height))
        numbers = re.findall(r"(?m)^\s*(\d{1,3})\s*$", footer)
        printed = int(numbers[-1]) if numbers else None
        # Never guess: reject footer numbers that are implausible page offsets.
        if printed is not None and abs(printed - page_number) > 25:
            printed = None

        image_name = f"{page_number}.jpg"
        page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False).save(pages_dir / image_name)

        lines = text.splitlines()
        equations = [line.strip() for line in lines if re.search(r"[=≠≤≥]|[a-z].*[+−×÷]", line)][:400]

        records.append(
            dict(
                pdfPage=page_number,
                printedPage=printed,
                unit=unit,
                lesson=lesson,
                heading=lesson,
                text=text,
                equations=equations,
                image=image_name,
            )
        )

    output = dict(sha256=sha, totalPages=len(document), sourceId=source, pages=records)
    pathlib.Path(args.out).write_text(json.dumps(output, ensure_ascii=False))
    print(json.dumps({"pages": len(document), "indexed": len(records), "source": source}))


if __name__ == "__main__":
    main()
