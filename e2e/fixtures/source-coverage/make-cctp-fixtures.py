"""Create only the local, synthetic A/B source-reference corpus; no network/DB."""

from hashlib import sha256
import json
from pathlib import Path
import sys

import pypdf
import reportlab
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parent
FILENAME = "ARMY-CCTP-calorifuge.pdf"
CLAUSES = {
    "C1": "Pour cet exercice, les réseaux CH-A en zone A et ECS-B en zone B reçoivent un calorifuge de 30 mm.",
    "C2": "En zone A, les parties droites et leurs deux raccords reçoivent une protection extérieure.",
    "C3": "En zone A, les deux raccords sont traités avec une finition démontable.",
    "C4": "Le diagnostic amiante de la zone A est exclu du présent lot dans cet exercice.",
    "C5": "Le traçage électrique du réseau ECS-B relève du lot Électricité.",
    "C6": "Les traversées de la zone B seront précisées par le détail D-B encore attendu.",
    "C7": "Les accès de pose en zone B restent à confirmer avant fixation du traitement des traversées.",
}
CLAUSE_B = "Pour cet exercice, le réseau CH-A en zone A reçoit un calorifuge de 40 mm ; le réseau ECS-B en zone B reste à 30 mm."
WIDTH, HEIGHT = 595.276, 841.890
INK = colors.HexColor("#17304A")
MUTED = colors.HexColor("#536374")
STYLE = ParagraphStyle("clause", fontName="Helvetica", fontSize=12, leading=19, textColor=INK)


def paragraph(canvas, text, top, width=475):
    node = Paragraph(text, STYLE)
    _, height = node.wrap(width, HEIGHT)
    node.drawOn(canvas, 60, top - height)
    return top - height


def frame(canvas, page, folio):
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(60, 790, "ARMY / CCTP CALORIFUGE")
    canvas.setStrokeColor(colors.HexColor("#CBD3DC"))
    canvas.line(60, 774, WIDTH - 60, 774)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(60, 43, "Corpus synthétique de qualification - aucune portée contractuelle")
    canvas.drawRightString(WIDTH - 60, 27, f"{folio} / page physique {page} sur 3")


def create_pdf(revision):
    directory = ROOT / revision
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / FILENAME
    if output.exists():
        raise RuntimeError(f"Refusing to overwrite an existing fixture: {output}")
    canvas = Canvas(str(output), pagesize=(WIDTH, HEIGHT), invariant=1, pageCompression=1)
    canvas.setTitle("ARMY - CCTP calorifuge - corpus synthétique")
    canvas.setAuthor("ARMY local qualification fixture")
    canvas.setSubject("Non-contractual synthetic source-reference corpus; no professional validation")
    frame(canvas, 1, "COUVERTURE")
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 28)
    canvas.drawString(60, 703, "CCTP / Calorifuge")
    canvas.setFont("Helvetica", 17)
    canvas.drawString(60, 668, f"Révision {revision}")
    paragraph(canvas, "Corpus synthétique de qualification", 618)
    paragraph(canvas, "Deux périmètres d'exercice : zone A / réseau CH-A et zone B / réseau ECS-B.", 560)
    paragraph(canvas, "Les épaisseurs et traitements servent uniquement aux assertions de recette. Ce document n'énonce aucun rendement normatif et n'a pas été validé par un chiffreur.", 478)
    paragraph(canvas, "Lecture : clauses C1 à C3, page physique 2 (CVC-10) ; clauses C4 à C7, page physique 3 (CVC-11).", 358)
    canvas.showPage()
    clauses = {**CLAUSES, **({"C1": CLAUSE_B} if revision == "B" else {})}
    for page, folio, ids in [(2, "CVC-10", ["C1", "C2", "C3"]), (3, "CVC-11", ["C4", "C5", "C6", "C7"])]:
        frame(canvas, page, folio)
        canvas.setFont("Helvetica-Bold", 22)
        canvas.setFillColor(INK)
        canvas.drawString(60, 725, "Prescriptions de l'exercice")
        top = 671
        for clause_id in ids:
            canvas.setFont("Helvetica-Bold", 12)
            canvas.setFillColor(INK)
            canvas.drawString(60, top, clause_id)
            top = paragraph(canvas, clauses[clause_id], top - 18) - 43
        if top < 90:
            raise RuntimeError("Clause content crossed the safe footer boundary")
        canvas.showPage()
    canvas.save()
    raw = output.read_bytes()
    reader = PdfReader(output)
    assert not reader.is_encrypted and len(reader.pages) == 3
    text = [page.extract_text() for page in reader.pages]
    for clause_id, value in clauses.items():
        physical_page = 2 if clause_id in ("C1", "C2", "C3") else 3
        assert value in " ".join(text[physical_page - 1].split()), clause_id
    return {
        "revision": revision, "path": output.relative_to(ROOT).as_posix(), "fileName": FILENAME,
        "sha256": sha256(raw).hexdigest(), "byteSize": len(raw), "pageCount": 3,
        "encrypted": False, "pages": [
            {"physicalPage": index + 1, "folio": ["COUVERTURE", "CVC-10", "CVC-11"][index], "text": value}
            for index, value in enumerate(text)
        ],
        "clauses": [{"id": key, "physicalPage": 2 if key in ("C1", "C2", "C3") else 3, "text": value} for key, value in clauses.items()],
    }


if __name__ == "__main__":
    manifest_path = ROOT / "manifest.json"
    if manifest_path.exists():
        raise RuntimeError("Refusing to overwrite an existing corpus manifest")
    documents = [create_pdf(revision) for revision in ["A", "B"]]
    assert documents[0]["sha256"] != documents[1]["sha256"]
    assert documents[0]["pages"][2]["text"] == documents[1]["pages"][2]["text"]
    manifest = {
        "schemaVersion": "source-reference-corpus-1", "status": "fixtures-created-not-e2e-executed",
        "generator": {"path": Path(__file__).name, "sha256": sha256(Path(__file__).read_bytes()).hexdigest(), "python": sys.version.split()[0], "reportlab": reportlab.Version, "pypdf": pypdf.__version__, "deterministicPdf": True},
        "documents": documents,
        "limits": ["Synthetic corpus; no normative yield or professional validation.", "Three real PDF pages; physical page numbering is one-based.", "PDF creation and inspection do not qualify server parsing, Storage bytes, HTTP, UI, or authorization."],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "documents": [{key: row[key] for key in ["revision", "path", "sha256", "byteSize", "pageCount"]} for row in documents]}))
