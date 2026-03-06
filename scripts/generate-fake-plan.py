#!/usr/bin/env python3
"""
Generate a fake BTP floor plan PDF for testing the takeoff (metre) feature.

Produces a 2-page PDF with:
- Page 1: RDC (ground floor) — labeled rooms with dimensions, doors, windows
- Page 2: Legende + tableau recapitulatif des quantites

Usage:
    python3 scripts/generate-fake-plan.py [output_path]
    # Default output: docs/test-fixtures/fake-plan-lot-archi.pdf
"""

import os
import sys

from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import (
    black, white, gray, lightgrey, HexColor,
)
from reportlab.pdfgen.canvas import Canvas

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "test-fixtures")
DEFAULT_OUTPUT = os.path.join(OUTPUT_DIR, "fake-plan-lot-archi.pdf")

# Colors
WALL_COLOR = black
FILL_LIGHT = HexColor("#F0F4F8")
FILL_WET = HexColor("#D6EAF8")
FILL_TERRACE = HexColor("#E8F5E9")
DIM_COLOR = HexColor("#C0392B")
TEXT_COLOR = HexColor("#2C3E50")
GRID_COLOR = HexColor("#BDC3C7")
CARTOUCHE_BG = HexColor("#FDFEFE")

# Scale: 1 unit = 1 cm on paper, rooms defined in "real meters" then scaled
SCALE = 1.2 * cm  # 1m real = 1.2cm on paper


def draw_room(c, x, y, w, h, label, area_m2, fill=FILL_LIGHT):
    """Draw a room rectangle with label and area."""
    px, py, pw, ph = x * SCALE, y * SCALE, w * SCALE, h * SCALE
    c.setFillColor(fill)
    c.setStrokeColor(WALL_COLOR)
    c.setLineWidth(2)
    c.rect(px, py, pw, ph, fill=1, stroke=1)

    c.setFillColor(TEXT_COLOR)
    c.setFont("Helvetica-Bold", 9)
    cx, cy = px + pw / 2, py + ph / 2
    c.drawCentredString(cx, cy + 4 * mm, label)
    c.setFont("Helvetica", 7)
    c.drawCentredString(cx, cy - 2 * mm, f"{area_m2:.1f} m2")


def draw_dimension(c, x1, y1, x2, y2, label, offset=5 * mm):
    """Draw a dimension line with arrows and label."""
    px1, py1 = x1 * SCALE, y1 * SCALE
    px2, py2 = x2 * SCALE, y2 * SCALE

    is_horizontal = abs(py2 - py1) < 1
    c.setStrokeColor(DIM_COLOR)
    c.setLineWidth(0.5)
    c.setFillColor(DIM_COLOR)
    c.setFont("Helvetica", 6)

    if is_horizontal:
        ly = py1 + offset
        c.line(px1, ly, px2, ly)
        c.line(px1, ly - 2 * mm, px1, ly + 2 * mm)
        c.line(px2, ly - 2 * mm, px2, ly + 2 * mm)
        c.drawCentredString((px1 + px2) / 2, ly + 2 * mm, label)
    else:
        lx = px1 + offset
        c.line(lx, py1, lx, py2)
        c.line(lx - 2 * mm, py1, lx + 2 * mm, py1)
        c.line(lx - 2 * mm, py2, lx + 2 * mm, py2)
        c.saveState()
        c.translate(lx + 2.5 * mm, (py1 + py2) / 2)
        c.rotate(90)
        c.drawCentredString(0, 0, label)
        c.restoreState()


def draw_door(c, x, y, width=0.9, horizontal=True):
    """Draw a door symbol (arc + line)."""
    px, py = x * SCALE, y * SCALE
    dw = width * SCALE
    c.setStrokeColor(WALL_COLOR)
    c.setLineWidth(1)
    c.setFillColor(white)

    if horizontal:
        c.rect(px, py - 1 * mm, dw, 2 * mm, fill=1, stroke=0)
        c.arc(px, py, px + dw, py + dw, 0, 90)
    else:
        c.rect(px - 1 * mm, py, 2 * mm, dw, fill=1, stroke=0)
        c.arc(px, py, px + dw, py + dw, 0, 90)


def draw_window(c, x, y, width=1.2, horizontal=True):
    """Draw a window symbol (double line)."""
    px, py = x * SCALE, y * SCALE
    ww = width * SCALE
    c.setStrokeColor(HexColor("#3498DB"))
    c.setLineWidth(1.5)

    if horizontal:
        c.line(px, py, px + ww, py)
        c.line(px, py + 2 * mm, px + ww, py + 2 * mm)
    else:
        c.line(px, py, px, py + ww)
        c.line(px + 2 * mm, py, px + 2 * mm, py + ww)


def draw_cartouche(c, page_w, page_h):
    """Draw the title block (cartouche) in bottom-right corner."""
    cw, ch = 12 * cm, 4 * cm
    cx, cy = page_w - cw - 1 * cm, 1 * cm
    c.setFillColor(CARTOUCHE_BG)
    c.setStrokeColor(black)
    c.setLineWidth(1)
    c.rect(cx, cy, cw, ch, fill=1, stroke=1)
    c.line(cx, cy + ch - 1 * cm, cx + cw, cy + ch - 1 * cm)

    c.setFillColor(TEXT_COLOR)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(cx + 5 * mm, cy + ch - 8 * mm, "RESIDENCE LES MUSIC")
    c.setFont("Helvetica", 8)
    c.drawString(cx + 5 * mm, cy + ch - 1.5 * cm, "LOT 01 - ARCHITECTURE")
    c.drawString(cx + 5 * mm, cy + ch - 2 * cm, "Plan RDC - Logement T3 Type A")
    c.drawString(cx + 5 * mm, cy + ch - 2.5 * cm, "Echelle: 1/50")
    c.drawString(cx + 5 * mm, cy + 5 * mm, "Cabinet ARCHI-TEST  |  Mars 2026  |  Ind. A")
    c.drawString(cx + 8 * cm, cy + 5 * mm, "Phase: DCE")


def draw_page1_plan(c, page_w, page_h):
    """Draw the ground floor plan (RDC)."""
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(TEXT_COLOR)
    c.drawString(2 * cm, page_h - 2 * cm, "PLAN RDC - LOGEMENT T3 TYPE A")
    c.setFont("Helvetica", 9)
    c.drawString(2 * cm, page_h - 2.8 * cm, "Echelle 1/50  |  Cotes en metres")

    # Origin offset
    ox, oy = 4, 5  # in scale units (meters)

    # Rooms (x, y, w, h in meters, label, area)
    rooms = [
        (ox, oy, 5.0, 4.5, "SEJOUR / SALON", 22.5, FILL_LIGHT),
        (ox + 5.0, oy, 3.5, 4.5, "CUISINE", 15.8, FILL_WET),
        (ox, oy + 4.5, 3.5, 3.0, "CHAMBRE 1", 10.5, FILL_LIGHT),
        (ox + 3.5, oy + 4.5, 3.0, 3.0, "CHAMBRE 2", 9.0, FILL_LIGHT),
        (ox + 6.5, oy + 4.5, 2.0, 3.0, "SDB", 6.0, FILL_WET),
        (ox + 6.5, oy + 4.5 + 3.0, 2.0, 1.5, "WC", 3.0, FILL_WET),
        (ox, oy + 4.5 + 3.0, 6.5, 1.5, "DEGAGEMENT", 9.8, FILL_LIGHT),
        (ox - 2.0, oy, 2.0, 3.0, "TERRASSE", 6.0, FILL_TERRACE),
    ]

    for room in rooms:
        draw_room(c, *room)

    # Dimensions
    draw_dimension(c, ox, oy, ox + 5.0, oy, "5.00", offset=-8 * mm)
    draw_dimension(c, ox + 5.0, oy, ox + 8.5, oy, "3.50", offset=-8 * mm)
    draw_dimension(c, ox, oy, ox, oy + 4.5, "4.50", offset=-8 * mm)
    draw_dimension(c, ox, oy + 4.5, ox, oy + 7.5, "3.00", offset=-8 * mm)
    draw_dimension(c, ox, oy + 7.5, ox, oy + 9.0, "1.50", offset=-8 * mm)
    draw_dimension(c, ox, oy + 4.5, ox + 3.5, oy + 4.5, "3.50", offset=8 * mm)
    draw_dimension(c, ox + 3.5, oy + 4.5, ox + 6.5, oy + 4.5, "3.00", offset=8 * mm)
    draw_dimension(c, ox + 6.5, oy + 4.5, ox + 8.5, oy + 4.5, "2.00", offset=8 * mm)

    # Doors
    draw_door(c, ox + 2.0, oy + 4.5, 0.9, horizontal=True)
    draw_door(c, ox + 4.5, oy + 4.5, 0.8, horizontal=True)
    draw_door(c, ox + 6.5, oy + 5.5, 0.8, horizontal=False)
    draw_door(c, ox + 6.5, oy + 7.7, 0.7, horizontal=False)
    draw_door(c, ox + 1.5, oy + 7.5, 0.9, horizontal=True)

    # Windows
    draw_window(c, ox + 1.5, oy, 1.4, horizontal=True)
    draw_window(c, ox + 6.0, oy, 1.2, horizontal=True)
    draw_window(c, ox + 0.5, oy + 5.5, 1.2, horizontal=False)
    draw_window(c, ox + 4.0, oy + 5.5, 1.0, horizontal=False)

    # Total exterior dimension
    draw_dimension(c, ox, oy, ox + 8.5, oy, "8.50", offset=-15 * mm)
    draw_dimension(c, ox, oy, ox, oy + 9.0, "9.00", offset=-15 * mm)

    draw_cartouche(c, page_w, page_h)


def draw_page2_quantities(c, page_w, page_h):
    """Draw page 2: legend + quantity summary table."""
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(TEXT_COLOR)
    c.drawString(2 * cm, page_h - 2 * cm, "TABLEAU RECAPITULATIF DES SURFACES ET QUANTITES")
    c.setFont("Helvetica", 9)
    c.drawString(2 * cm, page_h - 2.8 * cm,
                 "RESIDENCE LES MUSIC  |  LOT 01 - ARCHITECTURE  |  T3 Type A")

    # Table data
    headers = ["Poste", "Designation", "Quantite", "Unite"]
    rows = [
        ["01", "Sejour / Salon - surface plancher", "22.50", "m2"],
        ["02", "Cuisine - surface plancher", "15.75", "m2"],
        ["03", "Chambre 1 - surface plancher", "10.50", "m2"],
        ["04", "Chambre 2 - surface plancher", "9.00", "m2"],
        ["05", "SDB - surface plancher (faience)", "6.00", "m2"],
        ["06", "WC - surface plancher (faience)", "3.00", "m2"],
        ["07", "Degagement - surface plancher", "9.75", "m2"],
        ["08", "Terrasse - surface exterieure", "6.00", "m2"],
        ["09", "Cloisons interieures BA13 (h=2.50m)", "42.00", "ml"],
        ["10", "Doublage peripherique (h=2.50m)", "35.00", "ml"],
        ["11", "Portes interieures (73cm + 83cm)", "5", "u"],
        ["12", "Porte d'entree blindee", "1", "u"],
        ["13", "Fenetres double vitrage (1.40x1.20)", "2", "u"],
        ["14", "Fenetres double vitrage (1.20x1.20)", "1", "u"],
        ["15", "Fenetres double vitrage (1.00x0.60)", "1", "u"],
        ["16", "Baie vitree coulissante (2.00x2.20)", "1", "u"],
        ["17", "Peinture murs et plafonds (2 couches)", "185.00", "m2"],
        ["18", "Carrelage sol sejour + degagement", "32.25", "m2"],
        ["19", "Carrelage sol cuisine + SDB + WC", "24.75", "m2"],
        ["20", "Parquet stratifie chambres", "19.50", "m2"],
        ["21", "Plinthes (h=8cm)", "52.00", "ml"],
        ["22", "Faux plafond BA13 sur ossature", "76.50", "m2"],
        ["23", "Seuil de porte (pierre naturelle)", "5", "u"],
        ["24", "Garde-corps terrasse (alu laque)", "4.00", "ml"],
    ]

    # Draw table
    table_x = 2 * cm
    table_y = page_h - 3.5 * cm
    col_widths = [2 * cm, 12 * cm, 3 * cm, 2 * cm]
    row_height = 0.7 * cm
    total_w = sum(col_widths)

    # Header
    c.setFillColor(HexColor("#2C3E50"))
    c.rect(table_x, table_y - row_height, total_w, row_height, fill=1, stroke=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 8)
    x_pos = table_x
    for i, header in enumerate(headers):
        c.drawString(x_pos + 3 * mm, table_y - row_height + 2.5 * mm, header)
        x_pos += col_widths[i]

    # Rows
    for row_idx, row in enumerate(rows):
        ry = table_y - (row_idx + 2) * row_height
        bg = white if row_idx % 2 == 0 else HexColor("#F8F9FA")
        c.setFillColor(bg)
        c.rect(table_x, ry, total_w, row_height, fill=1, stroke=0)
        c.setStrokeColor(lightgrey)
        c.setLineWidth(0.5)
        c.rect(table_x, ry, total_w, row_height, fill=0, stroke=1)

        c.setFillColor(TEXT_COLOR)
        c.setFont("Helvetica", 7)
        x_pos = table_x
        for i, cell in enumerate(row):
            c.drawString(x_pos + 3 * mm, ry + 2 * mm, cell)
            x_pos += col_widths[i]

    # Total
    total_y = table_y - (len(rows) + 2) * row_height
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(TEXT_COLOR)
    c.drawString(table_x, total_y,
                 "Surface habitable totale (SHAB): 76.50 m2  |  "
                 "Surface utile totale: 82.50 m2")

    # Legend
    legend_y = total_y - 2 * cm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(table_x, legend_y, "LEGENDE")
    c.setFont("Helvetica", 7)
    legend_items = [
        (FILL_LIGHT, "Pieces seches (sejour, chambres, degagement)"),
        (FILL_WET, "Pieces humides (cuisine, SDB, WC)"),
        (FILL_TERRACE, "Espaces exterieurs (terrasse, balcon)"),
    ]
    for i, (color, label) in enumerate(legend_items):
        ly = legend_y - (i + 1) * 0.6 * cm
        c.setFillColor(color)
        c.rect(table_x, ly, 0.5 * cm, 0.4 * cm, fill=1, stroke=1)
        c.setFillColor(TEXT_COLOR)
        c.drawString(table_x + 0.8 * cm, ly + 1 * mm, label)

    draw_cartouche(c, page_w, page_h)


def main():
    output_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    page_w, page_h = landscape(A3)
    c = Canvas(output_path, pagesize=landscape(A3))

    # Page 1: Floor plan
    draw_page1_plan(c, page_w, page_h)
    c.showPage()

    # Page 2: Quantities table
    draw_page2_quantities(c, page_w, page_h)
    c.showPage()

    c.save()
    print(f"Generated: {output_path}")
    print(f"  Pages: 2 (plan RDC + tableau recapitulatif)")
    print(f"  Size: {os.path.getsize(output_path) / 1024:.1f} Ko")


if __name__ == "__main__":
    main()
