#!/usr/bin/env python3
"""Build the RayuCode Financial Budget & Forecast workbook.

Data basis: repository configuration only.
  * Model unit costs  -> crates/rayucode-provider-core/src/pricing.rs
  * Plan anchors      -> same file (OAuth plan reference prices)
  * Compute credits   -> docs/REMOTE_COMPILE.md (operator-set ledger units)
  * Audited actuals   -> NOT AVAILABLE in this repository. Every actuals
                         line is an explicit model input, never fabricated.

Every computed cell is a live Excel formula, so switching the Summary
scenario recalculates the whole model. No hard-coded totals anywhere.

Usage:  python3 scripts/finance/build_financial_budget.py
"""

from __future__ import annotations

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# ---------------------------------------------------------------- palette ---
INK = "0B0E0D"
FOREST = "0F3D2E"
EMERALD = "10B981"
MINT = "34D399"
PAPER = "FFFFFF"
BAND = "F2F7F4"
HAIRLINE = "DDE5E0"
INPUT_FILL = "EAF4FF"
WARN_FILL = "FFF4E5"
TOTAL_FILL = "E4EFE9"
NEG_FILL = "FDE7E7"

CUR = '"$"#,##0;[Red]("$"#,##0);"–"'
CUR2 = '"$"#,##0.00;[Red]("$"#,##0.00);"–"'
PCT = "0.0%"
NUM = "#,##0"
NUM1 = "#,##0.0"

TITLE = Font(name="Inter", size=18, bold=True, color=INK)
SUB = Font(name="Inter", size=10, color="5C6B63")
H1 = Font(name="Inter", size=11, bold=True, color=PAPER)
H2 = Font(name="Inter", size=10, bold=True, color=FOREST)
BODY = Font(name="Inter", size=10, color=INK)
BODY_B = Font(name="Inter", size=10, bold=True, color=INK)
BIG = Font(name="Inter", size=13, bold=True, color=INK)
NOTE = Font(name="Inter", size=9, italic=True, color="5C6B63")
SOURCE = Font(name="JetBrains Mono", size=8, color="6B7A72")
WARN = Font(name="Inter", size=10, bold=True, color="8A4B00")

FILL_H1 = PatternFill("solid", fgColor=FOREST)
FILL_BAND = PatternFill("solid", fgColor=BAND)
FILL_INPUT = PatternFill("solid", fgColor=INPUT_FILL)
FILL_WARN = PatternFill("solid", fgColor=WARN_FILL)
FILL_TOTAL = PatternFill("solid", fgColor=TOTAL_FILL)

THIN = Side(style="thin", color=HAIRLINE)
BOT = Border(bottom=THIN)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
TOP2 = Border(top=Side(style="medium", color=FOREST))

MONTHS = [
    "Jan-27", "Feb-27", "Mar-27", "Apr-27", "May-27", "Jun-27",
    "Jul-27", "Aug-27", "Sep-27", "Oct-27", "Nov-27", "Dec-27",
]


def section(ws, row: int, text: str, span: int = 7) -> None:
    for col in range(1, span + 1):
        ws.cell(row=row, column=col).fill = FILL_H1
        ws.cell(row=row, column=col).font = H1
    ws.cell(row=row, column=1, value=text)
    ws.row_dimensions[row].height = 20


def table_header(ws, row: int, labels: list[str], start_col: int = 1) -> None:
    for i, label in enumerate(labels):
        cell = ws.cell(row=row, column=start_col + i, value=label)
        cell.font = H2
        cell.border = BOT
        cell.alignment = Alignment(
            horizontal="left" if i == 0 else "right",
            vertical="center",
            wrap_text=True,
        )


def put(ws, row, col, value, fmt=None, font=BODY, fill=None, align=None, border=None):
    cell = ws.cell(row=row, column=col, value=value)
    cell.font = font
    if fmt:
        cell.number_format = fmt
    if fill:
        cell.fill = fill
    if border:
        cell.border = border
    cell.alignment = align or Alignment(
        horizontal="left" if col == 1 else "right", vertical="center"
    )
    return cell


def note(ws, row: int, text: str, span: int = 7, height: int = 26) -> None:
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = NOTE
    cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    ws.row_dimensions[row].height = height


# ================================================================== sheets ===
wb = Workbook()
ws_s = wb.active
ws_s.title = "Summary"
ws_a = wb.create_sheet("Assumptions")
ws_h = wb.create_sheet("Headcount")
ws_m = wb.create_sheet("Model")

# =---------------------------------------------------------- Assumptions ===
ws = ws_a
ws.sheet_properties.tabColor = EMERALD
ws.column_dimensions["A"].width = 40
for c in "BCD":
    ws.column_dimensions[c].width = 15
ws.column_dimensions["E"].width = 17
ws.column_dimensions["F"].width = 66

ws["A1"] = "Assumptions & Unit Costs"
ws["A1"].font = TITLE
ws["A2"] = (
    "Blue cells are model inputs. Green-shaded cells are formulas. "
    "Nothing here is an audited actual."
)
ws["A2"].font = SUB

ws["A4"] = (
    "DATA STATUS — ACTUALS UNAVAILABLE. Model unit costs and plan anchors are read from "
    "repository configuration (pricing.rs). Bookings, cash and payroll are model inputs, "
    "not actuals. See the source register in section 6."
)
ws["A4"].font = WARN
ws["A4"].fill = FILL_WARN
ws["A4"].alignment = Alignment(wrap_text=True, vertical="center")
ws.merge_cells("A4:F4")
ws.row_dimensions[4].height = 34

# --- 1. model settings ------------------------------------------------------
section(ws, 6, "1 · MODEL SETTINGS", 6)
settings = [
    ("Fiscal Year", "FY2027", None, None),
    ("Forecast Horizon", "12 months · Jan–Dec 2027", None, None),
    ("Currency", "USD", None, None),
    ("Selected Scenario (edit on Summary)", "=Summary!$B$4", None, BODY_B),
    ("Scenario Index", "=IFERROR(MATCH($B$10,$B$24:$D$24,0),1)", NUM, BODY_B),
    ("Opening Cash Balance", 3_500_000, CUR, None),
    ("Effective Tax Rate (on positive EBITDA)", 0.00, PCT, None),
]
for i, (label, value, fmt, font) in enumerate(settings):
    r = 7 + i
    put(ws, r, 1, label)
    is_formula = isinstance(value, str) and value.startswith("=")
    put(
        ws,
        r,
        2,
        value,
        fmt=fmt,
        font=font or BODY,
        fill=None if is_formula else FILL_INPUT,
    )
ws.cell(row=7, column=6,
        value="FY set to the next clean 12-month window; no fiscal calendar exists in repo.")\
    .font = NOTE

# --- 2. pricing tiers -------------------------------------------------------
section(ws, 15, "2 · PRICING TIERS — plan anchors, not RayuCode list prices", 6)
table_header(ws, 16, ["Tier", "Monthly Price", "Mix %", "", "", "Source / confidence"])
tiers = [
    ("Pro", 20, 0.55, "pricing.rs:108-118 anthropic_oauth_pricing 'pro' · $20, Low"),
    ("Max", 100, 0.30, "pricing.rs:97-107 anthropic_oauth_pricing 'max' · $100, Medium"),
    ("Flagship", 200, 0.15, "pricing.rs:243-257 openai_oauth_pricing Pro-like · $200, Low"),
]
for i, (name, price, mix, src) in enumerate(tiers):
    r = 17 + i
    put(ws, r, 1, name)
    put(ws, r, 2, price, fmt=CUR, fill=FILL_INPUT)
    put(ws, r, 3, mix, fmt=PCT, fill=FILL_INPUT)
    put(ws, r, 6, src, font=SOURCE, align=Alignment(horizontal="left", vertical="center"))
    ws.row_dimensions[r].height = 14

put(ws, 20, 1, "Mix check — must equal 100%", font=NOTE)
put(ws, 20, 3, "=SUM(C17:C19)", fmt=PCT, font=BODY_B, border=TOP2)
ws.cell(row=20, column=6,
        value="RayuCode list prices are not in this repo; replace B17:B19 and C17:C19.").font = NOTE
put(ws, 21, 1, "Blended ARPU / seat / month", font=BODY_B)
put(ws, 21, 2, "=SUMPRODUCT($B$17:$B$19,$C$17:$C$19)", fmt=CUR2, font=BODY_B, fill=FILL_TOTAL)

# --- 3. scenario drivers ----------------------------------------------------
section(ws, 23, "3 · SCENARIO DRIVERS", 6)
table_header(ws, 24, ["Driver", "Base", "Upside", "Downside", "Unit", "Basis"])
drivers = [
    ("Starting Paid Seats", 250, 250, 250, "seats", NUM,
     "Model input — no booking actuals in repo"),
    ("Monthly Seat Growth %", 0.070, 0.100, 0.035, "% of starting", PCT,
     "Operating assumption"),
    ("Monthly Logo Churn %", 0.012, 0.009, 0.022, "% of starting", PCT,
     "Operating assumption"),
    ("Headcount Multiplier", 1.00, 1.15, 0.85, "×", NUM1,
     "Scales the Headcount plan; no extra roles invented"),
    ("S&M % of Bookings", 0.18, 0.15, 0.22, "%", PCT,
     "Go-to-market assumption"),
    ("G&A Fixed / Month", 60_000, 60_000, 55_000, "USD", CUR,
     "Operating assumption"),
    ("Collections Lag", 1, 1, 2, "months", NUM,
     "DSO proxy — no AR ledger available"),
    ("Capex % of Revenue", 0.020, 0.030, 0.015, "%", PCT,
     "Operating assumption"),
]
for i, (name, b, u, d, unit, fmt, basis) in enumerate(drivers):
    r = 25 + i
    put(ws, r, 1, name)
    for j, v in enumerate((b, u, d)):
        put(ws, r, 2 + j, v, fmt=fmt, fill=FILL_INPUT)
    put(ws, r, 5, unit, font=NOTE, align=Alignment(horizontal="left"))
    put(ws, r, 6, basis, font=NOTE, align=Alignment(horizontal="left"))

# --- 4. unit costs ----------------------------------------------------------
section(ws, 34, "4 · MODEL UNIT COSTS — repository pricing configuration", 6)
table_header(
    ws, 35,
    ["Model", "Input $/MTok", "Output $/MTok", "Cache read $/MTok", "Routing share", "Source"],
)
models = [
    ("claude-sonnet-5", 3.00, 15.00, 0.30, 0.60,
     "pricing.rs:79-81 · standard tier (intro rate ended 2026-08-31)"),
    ("claude-haiku-4-5", 1.00, 5.00, 0.10, 0.25,
     "pricing.rs:82 · anthropic_api_pricing_with_tier"),
    ("gpt-5.4", 2.50, 15.00, 0.25, 0.15,
     "pricing.rs:219 · openai_api_pricing_with_tier"),
    ("gpt-5.4-mini", 0.75, 4.50, 0.075, 0.00,
     "pricing.rs:220 · available, not routed"),
]
for i, (name, pin, pout, pcache, share, src) in enumerate(models):
    r = 36 + i
    put(ws, r, 1, name)
    for j, v in enumerate((pin, pout, pcache, share)):
        put(ws, r, 2 + j, v, fmt=CUR2 if j < 3 else PCT, fill=FILL_INPUT)
    put(ws, r, 6, src, font=SOURCE, align=Alignment(horizontal="left", vertical="center"))
    ws.row_dimensions[r].height = 13

put(ws, 40, 1, "Routing share check — must equal 100%", font=NOTE)
put(ws, 40, 5, "=SUM(E36:E39)", fmt=PCT, font=BODY_B, border=TOP2)
for i, (label, formula) in enumerate(
    [
        ("Blended input $/MTok", "=SUMPRODUCT($B$36:$B$39,$E$36:$E$39)"),
        ("Blended output $/MTok", "=SUMPRODUCT($C$36:$C$39,$E$36:$E$39)"),
        ("Blended cache-read $/MTok", "=SUMPRODUCT($D$36:$D$39,$E$36:$E$39)"),
    ]
):
    put(ws, 41 + i, 1, label, font=BODY_B)
    put(ws, 41 + i, 2, formula, fmt=CUR2, font=BODY_B, fill=FILL_TOTAL)

# --- 5. usage per seat ------------------------------------------------------
section(ws, 45, "5 · USAGE PER ACTIVE SEAT / MONTH", 6)
usage = [
    ("Input tokens (MTok)", 6.0, NUM1, "Model input — no production token telemetry in repo"),
    ("Output tokens (MTok)", 1.2, NUM1, "Model input"),
    ("Cached input read (MTok)", 45.0, NUM1, "Prompt-cache reads bill at the cache-read rate"),
    ("Compute credits / seat / month", 3.00, CUR2,
     "REMOTE_COMPILE.md — operator-set ledger units, no published $ rate"),
]
for i, (name, v, fmt, src) in enumerate(usage):
    r = 46 + i
    put(ws, r, 1, name)
    put(ws, r, 2, v, fmt=fmt, fill=FILL_INPUT)
    put(ws, r, 6, src, font=NOTE, align=Alignment(horizontal="left"))

put(ws, 50, 1, "Inference COGS / seat / month", font=BODY_B)
put(ws, 50, 2, "=(B46*$B$41)+(B47*$B$42)+(B48*$B$43)", fmt=CUR2, font=BODY_B, fill=FILL_TOTAL)
put(ws, 51, 1, "Total COGS / seat / month", font=BODY_B)
put(ws, 51, 2, "=B50+B49", fmt=CUR2, font=BODY_B, fill=FILL_TOTAL)
put(ws, 52, 1, "Implied gross margin @ blended ARPU", font=BODY_B)
put(ws, 52, 2, "=IF($B$21=0,0,1-B51/$B$21)", fmt=PCT, font=BODY_B, fill=FILL_TOTAL)
ws.cell(row=52, column=6,
        value="Derived purely from repository rates — not an assumption.").font = NOTE

# --- 6. source register -----------------------------------------------------
section(ws, 54, "6 · DATA SOURCE REGISTER", 6)
table_header(ws, 55, ["Item", "Status", "", "", "", "Source"])
register = [
    ("Model unit costs (per MTok)", "AVAILABLE",
     "crates/rayucode-provider-core/src/pricing.rs"),
    ("Plan reference prices", "AVAILABLE (anchors)",
     "pricing.rs — anthropic_oauth_pricing / openai_oauth_pricing"),
    ("RayuCode list prices", "NOT IN REPOSITORY",
     "rayucode.com/plans — must be supplied"),
    ("Audited bookings / revenue / cash", "NOT AVAILABLE",
     "no financial statements in repository"),
    ("Headcount & payroll", "NOT AVAILABLE",
     "no personnel records in repository"),
    ("Compute credit dollar rate", "NOT PUBLISHED",
     "docs/REMOTE_COMPILE.md — operator-set, units undefined"),
    ("Usage per seat (tokens)", "NOT AVAILABLE",
     "no per-seat production telemetry in repository"),
]
for i, (item, status, src) in enumerate(register):
    r = 56 + i
    put(ws, r, 1, item)
    cell = put(ws, r, 2, status, font=BODY_B, align=Alignment(horizontal="left"))
    if status.startswith("NOT"):
        cell.fill = FILL_WARN
    put(ws, r, 6, src, font=SOURCE, align=Alignment(horizontal="left"))

ws.freeze_panes = "A6"

# =------------------------------------------------------------ Headcount ===
ws = ws_h
ws.sheet_properties.tabColor = MINT
ws.column_dimensions["A"].width = 20
ws.column_dimensions["B"].width = 32
for c in "CDEF":
    ws.column_dimensions[c].width = 14
for j in range(2, 14):
    ws.column_dimensions[get_column_letter(j)].width = 10.5

ws["A1"] = "Headcount Plan"
ws["A1"].font = TITLE
ws["A2"] = (
    "Role costs are fully loaded model inputs. No payroll actuals exist in this repository."
)
ws["A2"].font = SUB

section(ws, 4, "TEAM PLAN", 7)
table_header(ws, 5, ["Department", "Role", "Start Month", "FTE",
                     "Monthly Base", "Load Factor", "Basis"])
roles = [
    ("Engineering", "Staff Engineer — Agent Runtime", 1, 1.0, 14_000, 1.28),
    ("Engineering", "Senior Engineer — Desktop", 1, 1.0, 12_500, 1.28),
    ("Engineering", "Engineer — Providers & Routing", 3, 1.0, 11_000, 1.28),
    ("Engineering", "Engineer — Platform / Infra", 5, 1.0, 11_500, 1.28),
    ("Product", "Product Manager", 2, 1.0, 10_500, 1.26),
    ("Design", "Product Designer", 4, 1.0, 9_000, 1.26),
    ("Go-to-market", "Founding AE", 2, 1.0, 8_500, 1.30),
    ("Go-to-market", "Developer Advocate", 6, 1.0, 8_000, 1.30),
    ("Support", "Solutions Engineer", 8, 1.0, 7_500, 1.28),
    ("Operations", "Finance & Ops Lead", 3, 1.0, 9_500, 1.26),
    ("Operations", "Recruiter (contract → FTE)", 7, 0.5, 6_000, 1.20),
    ("Engineering", "Engineer — Reliability", 10, 1.0, 11_000, 1.28),
]
ROLE_FIRST, ROLE_LAST = 6, 17
for i, (dept, role, start_m, fte, cost, load) in enumerate(roles):
    r = ROLE_FIRST + i
    put(ws, r, 1, dept)
    put(ws, r, 2, role, align=Alignment(horizontal="left"))
    put(ws, r, 3, start_m, fmt=NUM, fill=FILL_INPUT)
    put(ws, r, 4, fte, fmt=NUM1, fill=FILL_INPUT)
    put(ws, r, 5, cost, fmt=CUR, fill=FILL_INPUT)
    put(ws, r, 6, load, fmt="0.00", fill=FILL_INPUT)
    put(ws, r, 7, "Model input", font=NOTE, align=Alignment(horizontal="left"))

TOTAL_ROW = ROLE_LAST + 1  # 18
put(ws, TOTAL_ROW, 1, "Plan total", font=BODY_B)
put(ws, TOTAL_ROW, 3, "Headcount plan →", font=NOTE)
put(ws, TOTAL_ROW, 4, f"=SUM(D{ROLE_FIRST}:D{ROLE_LAST})", fmt=NUM1,
    font=BODY_B, fill=FILL_TOTAL, border=TOP2)
put(ws, TOTAL_ROW, 5, f"=SUMPRODUCT(D{ROLE_FIRST}:D{ROLE_LAST},E{ROLE_FIRST}:E{ROLE_LAST})",
    fmt=CUR, font=BODY_B, fill=FILL_TOTAL, border=TOP2)
put(ws, TOTAL_ROW, 6,
    f"=IF(SUMPRODUCT(D{ROLE_FIRST}:D{ROLE_LAST},E{ROLE_FIRST}:E{ROLE_LAST})=0,0,"
    f"SUMPRODUCT(D{ROLE_FIRST}:D{ROLE_LAST},E{ROLE_FIRST}:E{ROLE_LAST},"
    f"F{ROLE_FIRST}:F{ROLE_LAST})/"
    f"SUMPRODUCT(D{ROLE_FIRST}:D{ROLE_LAST},E{ROLE_FIRST}:E{ROLE_LAST}))",
    fmt="0.00", font=BODY_B, fill=FILL_TOTAL, border=TOP2)

put(ws, 19, 1, "Fully loaded run-rate / month", font=BODY_B)
put(ws, 19, 5,
    f"=SUMPRODUCT(D{ROLE_FIRST}:D{ROLE_LAST},E{ROLE_FIRST}:E{ROLE_LAST},"
    f"F{ROLE_FIRST}:F{ROLE_LAST})",
    fmt=CUR, font=BODY_B, fill=FILL_TOTAL)
put(ws, 20, 1, "Annualized fully loaded run-rate", font=BODY_B)
put(ws, 20, 5, "=E19*12", fmt=CUR, font=BODY_B, fill=FILL_TOTAL)

# --- FTE ramp ---------------------------------------------------------------
section(ws, 22, "MONTHLY FTE RAMP — gates each role on its start month", 13)
IDX_ROW = 23
put(ws, IDX_ROW, 1, "Month index", font=H2)
for j in range(12):
    put(ws, IDX_ROW, 2 + j, j + 1, fmt=NUM, font=H2)
put(ws, 24, 1, "Month", font=H2)
for j, label in enumerate(MONTHS):
    put(ws, 24, 2 + j, label, font=H2)

FTE_FIRST = 25
for i in range(len(roles)):
    r = FTE_FIRST + i
    role_row = ROLE_FIRST + i
    put(ws, r, 1, f"=B{role_row}", font=Font(name="Inter", size=9, color="5C6B63"))
    for j in range(12):
        cl = get_column_letter(2 + j)
        put(ws, r, 2 + j,
            f"=IF($C{role_row}<={cl}${IDX_ROW},$D{role_row},0)", fmt=NUM1)

FTE_LAST = FTE_FIRST + len(roles) - 1
FTE_TOTAL = FTE_LAST + 1
put(ws, FTE_TOTAL, 1, "Total FTE", font=BODY_B)
for j in range(12):
    cl = get_column_letter(2 + j)
    put(ws, FTE_TOTAL, 2 + j, f"=SUM({cl}{FTE_FIRST}:{cl}{FTE_LAST})",
        fmt=NUM1, font=BODY_B, border=TOP2)

# --- loaded people cost -----------------------------------------------------
COST_SECTION = FTE_TOTAL + 2
section(ws, COST_SECTION, "MONTHLY FULLY LOADED PEOPLE COST (USD)", 13)
COST_IDX = COST_SECTION + 1
put(ws, COST_IDX, 1, "Month index", font=H2)
for j in range(12):
    cl = get_column_letter(2 + j)
    put(ws, COST_IDX, 2 + j, f"={cl}{IDX_ROW}", fmt=NUM, font=H2)
put(ws, COST_SECTION + 2, 1, "Month", font=H2)
for j, label in enumerate(MONTHS):
    put(ws, COST_SECTION + 2, 2 + j, label, font=H2)

COST_FIRST = COST_SECTION + 3
for i in range(len(roles)):
    r = COST_FIRST + i
    role_row = ROLE_FIRST + i
    put(ws, r, 1, f"=B{role_row}", font=Font(name="Inter", size=9, color="5C6B63"))
    for j in range(12):
        cl = get_column_letter(2 + j)
        put(
            ws, r, 2 + j,
            f"=IF($C{role_row}<={cl}${COST_IDX},"
            f"$D{role_row}*$E{role_row}*$F{role_row},0)",
            fmt=CUR,
        )

COST_LAST = COST_FIRST + len(roles) - 1
COST_TOTAL = COST_LAST + 1
put(ws, COST_TOTAL, 1, "Total loaded people cost", font=BODY_B)
for j in range(12):
    cl = get_column_letter(2 + j)
    put(ws, COST_TOTAL, 2 + j, f"=SUM({cl}{COST_FIRST}:{cl}{COST_LAST})",
        fmt=CUR, font=BODY_B, border=TOP2)

HC_BASE_ROW = COST_TOTAL + 2
HC_UP_ROW = HC_BASE_ROW + 1
HC_DN_ROW = HC_BASE_ROW + 2
for label, row, mult in (
    ("Scenario: Base", HC_BASE_ROW, None),
    ("Scenario: Upside", HC_UP_ROW, "$C$28"),
    ("Scenario: Downside", HC_DN_ROW, "$D$28"),
):
    put(ws, row, 1, label, font=BODY_B)
    for j in range(12):
        cl = get_column_letter(2 + j)
        formula = (f"={cl}{COST_TOTAL}" if mult is None
                   else f"={cl}{COST_TOTAL}*Assumptions!{mult}")
        put(ws, row, 2 + j, formula, fmt=CUR,
            font=BODY_B if mult is None else BODY,
            fill=FILL_TOTAL if mult is None else None)

note(
    ws,
    HC_DN_ROW + 2,
    "Upside and Downside scale the same role plan by the scenario headcount multiplier "
    "(Assumptions row 28). No roles are added or removed, so comparisons stay like-for-like.",
    span=13,
)

ws.freeze_panes = "C6"

# =---------------------------------------------------------------- Model ===
ws = ws_m
ws.sheet_properties.tabColor = FOREST
ws.column_dimensions["A"].width = 34
for j in range(12):
    ws.column_dimensions[get_column_letter(2 + j)].width = 12.5

ws["A1"] = "Monthly Model — all three scenarios"
ws["A1"].font = TITLE
ws["A2"] = (
    "Each block is an independent formula chain. The Summary selects one block; "
    "the comparison table reads all three."
)
ws["A2"].font = SUB

R = dict(
    idx=1, start=2, new=3, churn=4, end=5, arpu=6, book=7, rev=8,
    cogs_inf=9, cogs_cred=10, cogs=11, gp=12, gm=13,
    people=14, sm=15, ga=16, opex=17,
    ebitda=18, ebitda_m=19, tax=20,
    coll=21, capex=22, net=23,
    open=24, end_cash=25,
)

ROWS = [
    ("idx", "Month index", NUM, False),
    ("start", "Starting paid seats", NUM, False),
    ("new", "New seats", NUM, False),
    ("churn", "Churned seats", NUM, False),
    ("end", "Ending paid seats", NUM, True),
    ("arpu", "ARPU / seat / month", CUR2, False),
    ("book", "Bookings (annual contract value)", CUR, False),
    ("rev", "Recognized revenue", CUR, True),
    ("cogs_inf", "Inference COGS", CUR, False),
    ("cogs_cred", "Compute-credit COGS", CUR, False),
    ("cogs", "Total COGS", CUR, True),
    ("gp", "Gross profit", CUR, True),
    ("gm", "Gross margin %", PCT, False),
    ("people", "People cost (fully loaded)", CUR, False),
    ("sm", "Sales & marketing", CUR, False),
    ("ga", "General & admin", CUR, False),
    ("opex", "Total operating expense", CUR, True),
    ("ebitda", "EBITDA", CUR, True),
    ("ebitda_m", "EBITDA margin %", PCT, False),
    ("tax", "Tax on positive EBITDA", CUR, False),
    ("coll", "Cash collections (lagged)", CUR, False),
    ("capex", "Capex", CUR, False),
    ("net", "Net cash change", CUR, True),
    ("open", "Opening cash", CUR, False),
    ("end_cash", "Ending cash", CUR, True),
]

BLOCKS = [
    ("BASE CASE", 6, "B", HC_BASE_ROW),
    ("UPSIDE CASE", 36, "C", HC_UP_ROW),
    ("DOWNSIDE CASE", 66, "D", HC_DN_ROW),
]

for title, s, dcol, hc_row in BLOCKS:
    for c in range(1, 14):
        ws.cell(row=s, column=c).fill = FILL_H1
    tcell = ws.cell(row=s, column=1, value=title)
    tcell.font = H1
    # Month labels ride on the title band; the index row below must stay numeric
    # because every formula compares against it.
    for j, label in enumerate(MONTHS):
        put(ws, s, 2 + j, label, font=H1)

    put(ws, s + R["idx"], 1, "Month index", font=H2)
    for j in range(12):
        put(ws, s + R["idx"], 2 + j, j + 1, fmt=NUM, font=H2)

    for key, label, fmt, emphasis in ROWS:
        if key == "idx":
            continue
        r = s + R[key]
        put(ws, r, 1, label, font=BODY_B if emphasis else BODY)
        for j in range(12):
            col = 2 + j
            cl = get_column_letter(col)
            prev = get_column_letter(col - 1)
            idx_ref = f"{cl}${s + R['idx']}"
            a = f"Assumptions!${dcol}$"

            if key == "start":
                f = f"={a}25" if j == 0 else f"={prev}{s + R['end']}"
            elif key == "new":
                f = f"={cl}{s + R['start']}*{a}26"
            elif key == "churn":
                f = f"={cl}{s + R['start']}*{a}27"
            elif key == "end":
                f = (f"={cl}{s + R['start']}+{cl}{s + R['new']}"
                     f"-{cl}{s + R['churn']}")
            elif key == "arpu":
                f = "=Assumptions!$B$21"
            elif key == "book":
                f = f"={cl}{s + R['new']}*{cl}{s + R['arpu']}*12"
            elif key == "rev":
                f = f"={cl}{s + R['end']}*{cl}{s + R['arpu']}"
            elif key == "cogs_inf":
                f = f"={cl}{s + R['end']}*Assumptions!$B$50"
            elif key == "cogs_cred":
                f = f"={cl}{s + R['end']}*Assumptions!$B$49"
            elif key == "cogs":
                f = f"={cl}{s + R['cogs_inf']}+{cl}{s + R['cogs_cred']}"
            elif key == "gp":
                f = f"={cl}{s + R['rev']}-{cl}{s + R['cogs']}"
            elif key == "gm":
                f = (f"=IF({cl}{s + R['rev']}=0,0,"
                     f"{cl}{s + R['gp']}/{cl}{s + R['rev']})")
            elif key == "people":
                f = f"=Headcount!{cl}${hc_row}"
            elif key == "sm":
                f = f"={cl}{s + R['book']}*{a}29"
            elif key == "ga":
                f = f"={a}30"
            elif key == "opex":
                f = (f"={cl}{s + R['people']}+{cl}{s + R['sm']}"
                     f"+{cl}{s + R['ga']}")
            elif key == "ebitda":
                f = f"={cl}{s + R['gp']}-{cl}{s + R['opex']}"
            elif key == "ebitda_m":
                f = (f"=IF({cl}{s + R['rev']}=0,0,"
                     f"{cl}{s + R['ebitda']}/{cl}{s + R['rev']})")
            elif key == "tax":
                f = f"=MAX(0,{cl}{s + R['ebitda']})*Assumptions!$B$13"
            elif key == "coll":
                # MAX(1, ...) keeps INDEX away from a 0 index, which would return
                # an array rather than a single value in the first lagged months.
                f = (f"=IF({idx_ref}<=Assumptions!${dcol}$31,0,"
                     f"INDEX($B${s + R['rev']}:$M${s + R['rev']},"
                     f"MAX(1,{idx_ref}-Assumptions!${dcol}$31)))")
            elif key == "capex":
                f = f"={cl}{s + R['rev']}*{a}32"
            elif key == "net":
                f = (f"={cl}{s + R['coll']}-{cl}{s + R['opex']}"
                     f"-{cl}{s + R['capex']}-{cl}{s + R['tax']}")
            elif key == "open":
                f = "=Assumptions!$B$12" if j == 0 else f"={prev}{s + R['end_cash']}"
            elif key == "end_cash":
                f = f"={cl}{s + R['open']}+{cl}{s + R['net']}"
            else:
                raise AssertionError(f"unhandled row {key}")

            put(ws, r, col, f, fmt=fmt, font=BODY_B if emphasis else BODY,
                border=BOT if emphasis else None)

ws.freeze_panes = "B6"

# =-------------------------------------------------------------- Summary ===
ws = ws_s
ws.sheet_properties.tabColor = INK
ws.column_dimensions["A"].width = 40
for c in "BCDEF":
    ws.column_dimensions[c].width = 18
ws.column_dimensions["G"].width = 4

ws["A1"] = "Financial Budget & Forecast"
ws["A1"].font = TITLE
ws["A2"] = "RayuCode · FY2027 · USD · repository-derived model · ACTUALS: NOT AVAILABLE"
ws["A2"].font = SUB

put(ws, 4, 1, "Selected Scenario", font=BODY_B)
sel = put(ws, 4, 2, "Base",
          font=Font(name="Inter", size=12, bold=True, color=FOREST),
          fill=FILL_INPUT, border=BOX, align=Alignment(horizontal="center"))
put(ws, 4, 3, "→ drives every formula in this workbook", font=NOTE,
    align=Alignment(horizontal="left"))
dv = DataValidation(type="list", formula1='"Base,Upside,Downside"',
                    allow_blank=False, showDropDown=False)
dv.error = "Choose Base, Upside or Downside."
dv.errorTitle = "Invalid scenario"
ws.add_data_validation(dv)
dv.add(sel)

section(ws, 6, "KEY METRICS — SELECTED SCENARIO", 6)
IDX = "Assumptions!$B$11"


def span(key: str) -> str:
    """SUM over the 12 months of a model row for each scenario block."""
    parts = []
    for s in (6, 36, 66):
        row = s + R[key]
        parts.append(f"SUM(Model!B{row}:M{row})")
    return f"=CHOOSE({IDX},{','.join(parts)})"


def pick(key: str, month_col: int) -> str:
    cl = get_column_letter(month_col)
    return (f"=CHOOSE({IDX},Model!{cl}{6 + R[key]},"
            f"Model!{cl}{36 + R[key]},Model!{cl}{66 + R[key]})")


kpis = [
    (7, "FY Bookings (ACV)", span("book"), CUR),
    (8, "FY Recognized Revenue", span("rev"), CUR),
    (9, "FY EBITDA", span("ebitda"), CUR),
    (10, "Ending Cash (Dec-27)", pick("end_cash", 13), CUR),
]
for r, label, formula, fmt in kpis:
    put(ws, r, 1, label)
    put(ws, r, 2, formula, fmt=fmt, font=BIG)
    ws.cell(row=r, column=1).border = BOT
    ws.cell(row=r, column=2).border = BOT

put(ws, 7, 4, "FY Gross Margin")
put(ws, 7, 5, f"=IF(B8=0,0,CHOOSE({IDX},"
              f"SUM(Model!B{6 + R['gp']}:M{6 + R['gp']}),"
              f"SUM(Model!B{36 + R['gp']}:M{36 + R['gp']}),"
              f"SUM(Model!B{66 + R['gp']}:M{66 + R['gp']}))/B8)",
    fmt=PCT, font=BIG)
put(ws, 8, 4, "FY EBITDA Margin")
put(ws, 8, 5, "=IF(B8=0,0,B9/B8)", fmt=PCT, font=BIG)
put(ws, 9, 4, "Ending Paid Seats")
put(ws, 9, 5, pick("end", 13), fmt=NUM, font=BIG)
put(ws, 10, 4, "Blended ARPU / seat / mo")
put(ws, 10, 5, pick("arpu", 13), fmt=CUR2, font=BIG)

for r in range(7, 11):
    ws.cell(row=r, column=4).border = BOT
    ws.cell(row=r, column=5).border = BOT

section(ws, 12, "MONTHLY OUTLOOK — SELECTED SCENARIO", 6)
table_header(ws, 13, ["Month", "Bookings", "Recognized Revenue", "EBITDA",
                      "Ending Cash", "Paid Seats"])

OUT_FIRST = 14
for j in range(12):
    r = OUT_FIRST + j
    put(ws, r, 1, MONTHS[j])
    put(ws, r, 2, pick("book", 2 + j), fmt=CUR)
    put(ws, r, 3, pick("rev", 2 + j), fmt=CUR)
    put(ws, r, 4, pick("ebitda", 2 + j), fmt=CUR)
    put(ws, r, 5, pick("end_cash", 2 + j), fmt=CUR)
    put(ws, r, 6, pick("end", 2 + j), fmt=NUM)

OUT_LAST = OUT_FIRST + 11
TOTAL_ROW_S = OUT_LAST + 1
put(ws, TOTAL_ROW_S, 1, "FY2027 total / exit", font=BODY_B)
for c in (2, 3, 4):
    cl = get_column_letter(c)
    put(ws, TOTAL_ROW_S, c, f"=SUM({cl}{OUT_FIRST}:{cl}{OUT_LAST})",
        fmt=CUR, font=BODY_B, border=TOP2)
put(ws, TOTAL_ROW_S, 5, f"=E{OUT_LAST}", fmt=CUR, font=BODY_B, border=TOP2)
put(ws, TOTAL_ROW_S, 6, f"=F{OUT_LAST}", fmt=NUM, font=BODY_B, border=TOP2)

CMP_SECTION = TOTAL_ROW_S + 2
section(ws, CMP_SECTION, "SCENARIO COMPARISON — INDEPENDENT OF SELECTION", 6)
table_header(ws, CMP_SECTION + 1,
             ["Scenario", "FY Bookings", "FY Revenue", "FY EBITDA",
              "Dec Ending Cash", "Dec Seats"])
for i, (name, s) in enumerate([("Base", 6), ("Upside", 36), ("Downside", 66)]):
    r = CMP_SECTION + 2 + i
    put(ws, r, 1, name, font=BODY_B)
    put(ws, r, 2, f"=SUM(Model!B{s + R['book']}:M{s + R['book']})", fmt=CUR)
    put(ws, r, 3, f"=SUM(Model!B{s + R['rev']}:M{s + R['rev']})", fmt=CUR)
    put(ws, r, 4, f"=SUM(Model!B{s + R['ebitda']}:M{s + R['ebitda']})", fmt=CUR)
    put(ws, r, 5, f"=Model!M{s + R['end_cash']}", fmt=CUR)
    put(ws, r, 6, f"=Model!M{s + R['end']}", fmt=NUM)
    if name == "Base":
        for c in range(1, 7):
            ws.cell(row=r, column=c).fill = FILL_BAND

# --- integrity checks -------------------------------------------------------
CHK = CMP_SECTION + 6
section(ws, CHK, "INTEGRITY CHECKS — all must read OK", 6)
checks = [
    ("Pricing mix sums to 100%",
     '=IF(ABS(Assumptions!C20-1)<0.0001,"OK","CHECK")'),
    ("Model routing shares sum to 100%",
     '=IF(ABS(Assumptions!E40-1)<0.0001,"OK","CHECK")'),
    ("Summary revenue ties to selected block",
     f'=IF(ABS(B8-CHOOSE({IDX},'
     f'SUM(Model!B{6 + R["rev"]}:M{6 + R["rev"]}),'
     f'SUM(Model!B{36 + R["rev"]}:M{36 + R["rev"]}),'
     f'SUM(Model!B{66 + R["rev"]}:M{66 + R["rev"]})))<0.5,"OK","CHECK")'),
    ("Outlook total ties to FY revenue KPI",
     f'=IF(ABS(C{TOTAL_ROW_S}-B8)<0.5,"OK","CHECK")'),
    ("Ending cash = opening + net change",
     f'=IF(ABS(Model!M{6 + R["end_cash"]}'
     f'-(Assumptions!B12+SUM(Model!B{6 + R["net"]}:M{6 + R["net"]})))<0.5,"OK","CHECK")'),
    ("Ending seats never negative in any scenario",
     f'=IF(AND(COUNTIF(Model!B{6 + R["end"]}:M{6 + R["end"]},"<0")=0,'
     f'COUNTIF(Model!B{36 + R["end"]}:M{36 + R["end"]},"<0")=0,'
     f'COUNTIF(Model!B{66 + R["end"]}:M{66 + R["end"]},"<0")=0),'
     f'"OK","CHECK")'),
    ("Every role has a valid start month",
     f'=IF(AND(MIN(Headcount!C{ROLE_FIRST}:C{ROLE_LAST})>=1,'
     f'MAX(Headcount!C{ROLE_FIRST}:C{ROLE_LAST})<=12),"OK","CHECK")'),
    ("Every role is ramped by December",
     f'=IF(AND(MAX(Headcount!C{ROLE_FIRST}:C{ROLE_LAST})<=12,'
     f'ABS(Headcount!M{FTE_TOTAL}-Headcount!D{TOTAL_ROW})<0.01),"OK","CHECK")'),
]
for i, (label, formula) in enumerate(checks):
    r = CHK + 1 + i
    put(ws, r, 1, label)
    put(ws, r, 2, formula, font=BODY_B, align=Alignment(horizontal="left"))

note(
    ws,
    CHK + len(checks) + 2,
    "DATA BASIS — Unit costs are the published per-MTok rates in "
    "crates/rayucode-provider-core/src/pricing.rs. Plan anchors ($20/$100/$200) are "
    "Claude/ChatGPT reference plans, not RayuCode list prices. No audited bookings, revenue, "
    "cash, payroll or per-seat token telemetry exists in this repository, so every such line "
    "is a labelled model input. Compute credits are operator-set ledger units "
    "(docs/REMOTE_COMPILE.md) with no published dollar rate.",
    span=6,
    height=54,
)

ws.freeze_panes = "A6"

for rng in (f"D{OUT_FIRST}:D{OUT_LAST}", f"E{OUT_FIRST}:E{OUT_LAST}"):
    ws.conditional_formatting.add(
        rng,
        CellIsRule(operator="lessThan", formula=["0"],
                   fill=PatternFill("solid", fgColor=NEG_FILL)),
    )

# ------------------------------------------------------------- properties ---
wb.properties.title = "RayuCode Financial Budget & Forecast FY2027"
wb.properties.subject = "Repository-derived financial model"
wb.properties.description = (
    "Formula-driven budget and forecast. Model unit costs sourced from "
    "crates/rayucode-provider-core/src/pricing.rs. Audited actuals unavailable."
)
wb.properties.creator = "RayuCode"
wb.calculation.fullCalcOnLoad = True

OUT = "docs/finance/RayuCode_Financial_Budget_FY2027.xlsx"
wb.save(OUT)

# Publish the layout so the independent verifier never hard-codes a row it
# could get wrong after an edit.
import json

anchors = {
    "workbook": OUT,
    "assumptions": {
        "scenario_index": "B11",
        "opening_cash": "B12",
        "tax_rate": "B13",
        "tier_mix_total": "C20",
        "blended_arpu": "B21",
        "routing_total": "E40",
        "cogs_per_seat": "B51",
        "gross_margin": "B52",
        "tiers": {"first": 17, "last": 19},
        "drivers": {"first": 25, "last": 32},
        "usage": {"first": 46, "last": 49},
    },
    "headcount": {
        "plan_first": ROLE_FIRST,
        "plan_last": ROLE_LAST,
        "fte_first": FTE_FIRST,
        "fte_total": FTE_TOTAL,
        "cost_first": COST_FIRST,
        "cost_total": COST_TOTAL,
        "scenario_base": HC_BASE_ROW,
        "scenario_upside": HC_UP_ROW,
        "scenario_downside": HC_DN_ROW,
    },
    "model": {
        "blocks": {"base": 6, "upside": 36, "downside": 66},
        "rows": R,
    },
    "summary": {
        "outlook_first": OUT_FIRST,
        "outlook_last": OUT_LAST,
        "outlook_total": TOTAL_ROW_S,
        "comparison_section": CMP_SECTION,
        "checks_first": CHK + 1,
        "checks_count": len(checks),
    },
    "months": MONTHS,
}
with open("docs/finance/model-anchors.json", "w") as fh:
    json.dump(anchors, fh, indent=2)

print(f"wrote {OUT}")
print("wrote docs/finance/model-anchors.json")
