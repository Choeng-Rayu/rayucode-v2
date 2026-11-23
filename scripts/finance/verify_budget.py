"""Independently recalculate the generated workbook and assert its invariants.

Uses the `formulas` engine (a separate implementation from openpyxl) so the
checks do not echo the generator's arithmetic. Every expected value is rebuilt
from inputs *read out of the workbook*, never from constants baked here.

Run:  $RAYU_SCRATCH_DIR/xlsxverify/bin/python scripts/finance/verify_budget.py
"""

from __future__ import annotations

import json
import re
import sys

import formulas

ANCHOR_PATH = "docs/finance/model-anchors.json"

failures: list[str] = []
observations: list[str] = []


def main() -> int:
    with open(ANCHOR_PATH) as fh:
        A = json.load(fh)

    path = A["workbook"]
    book = path.split("/")[-1]
    sol = formulas.ExcelModel().loads(path).finish().calculate()

    def cell(sheet: str, ref: str):
        key = f"'[{book}]{sheet.upper()}'!{ref}"
        if key not in sol:
            raise KeyError(f"missing {key}")
        return sol[key].value[0, 0]

    def num(sheet: str, ref: str) -> float:
        value = cell(sheet, ref)
        if isinstance(value, str):
            raise ValueError(f"{sheet}!{ref} is text/error: {value!r}")
        return float(value)

    def fail(msg: str) -> None:
        failures.append(msg)

    def expect(actual: float, expected: float, label: str, tol: float = 0.01) -> None:
        if abs(actual - expected) > tol:
            fail(f"{label}: got {actual:,.4f}, expected {expected:,.4f}")

    # ---------------------------------------------------------- error sweep --
    errors: dict[str, list[str]] = {}
    for key, value in sol.items():
        if not isinstance(key, str):
            continue
        try:
            raw = value.value[0, 0]
        except Exception:
            continue
        if isinstance(raw, str) and raw.startswith("#") and "!" in key:
            ref = key.split("!")[1]
            if ":" in ref:
                continue
            sheet = re.search(r"\](\w+)'", key)
            errors.setdefault(sheet.group(1) if sheet else "?", []).append(ref)
    for sheet, refs in errors.items():
        fail(f"{sheet} has {len(refs)} error cells, e.g. {sorted(refs)[:6]}")

    asm = A["assumptions"]
    hc = A["headcount"]
    rows = A["model"]["rows"]
    months = A["months"]
    blocks = A["model"]["blocks"]
    s = A["summary"]

    # ------------------------------------------------- workbook self-consistency
    # Scenario index must land on the requested scenario.
    expect(num("Assumptions", asm["scenario_index"]), 1.0, "scenario index (Base)")
    if str(cell("Assumptions", "B10")).strip() != "Base":
        fail(f"selected scenario reads {cell('Assumptions','B10')!r}, expected 'Base'")

    # Blended ARPU rebuilt from tier prices and mix.
    tier_lo, tier_hi = asm["tiers"]["first"], asm["tiers"]["last"]
    prices = [num("Assumptions", f"B{r}") for r in range(tier_lo, tier_hi + 1)]
    mixes = [num("Assumptions", f"C{r}") for r in range(tier_lo, tier_hi + 1)]
    expect(sum(mixes), 1.0, "pricing mix sums to 100%", 1e-9)
    arpu = sum(p * m for p, m in zip(prices, mixes))
    expect(num("Assumptions", asm["blended_arpu"]), arpu, "blended ARPU")

    # Unit costs rebuilt from model rates and routing shares.
    rates, shares, usage = [], [], []
    for r in range(36, 40):
        rates.append((num("Assumptions", f"B{r}"), num("Assumptions", f"C{r}"),
                      num("Assumptions", f"D{r}")))
        shares.append(num("Assumptions", f"E{r}"))
    expect(sum(shares), 1.0, "routing shares sum to 100%", 1e-9)
    blended_in = sum(r[0] * w for r, w in zip(rates, shares))
    blended_out = sum(r[1] * w for r, w in zip(rates, shares))
    blended_cache = sum(r[2] * w for r, w in zip(rates, shares))
    expect(num("Assumptions", "B41"), blended_in, "blended input rate", 1e-6)
    expect(num("Assumptions", "B42"), blended_out, "blended output rate", 1e-6)
    expect(num("Assumptions", "B43"), blended_cache, "blended cache rate", 1e-6)

    u_lo = asm["usage"]["first"]
    in_tok, out_tok, cache_tok, credits = (num("Assumptions", f"B{u_lo + i}")
                                           for i in range(4))
    inference = in_tok * blended_in + out_tok * blended_out + cache_tok * blended_cache
    cogs_seat = inference + credits
    expect(num("Assumptions", asm["cogs_per_seat"]), cogs_seat, "COGS per seat")
    expect(num("Assumptions", asm["gross_margin"]), 1 - cogs_seat / arpu,
           "implied gross margin", 1e-9)

    observations.append(f"blended ARPU ${arpu:,.2f}/seat/mo")
    observations.append(f"COGS ${cogs_seat:,.2f}/seat/mo → GM {100*(1-cogs_seat/arpu):.1f}%")

    # ------------------------------------------------------------- Headcount --
    # Plan totals must equal the role rows (no hard-coded figure).
    plan_fte = 0.0
    plan_cost = 0.0
    plan_loaded = 0.0
    for r in range(hc["plan_first"], hc["plan_last"] + 1):
        fte = num("Headcount", f"D{r}")
        cost = num("Headcount", f"E{r}")
        load = num("Headcount", f"F{r}")
        plan_fte += fte
        plan_cost += fte * cost
        plan_loaded += fte * cost * load
    expect(num("Headcount", f"D{hc['plan_last'] + 1}"), plan_fte, "plan FTE total", 1e-9)
    expect(num("Headcount", "E19"), plan_loaded, "loaded monthly run-rate", 0.5)
    expect(num("Headcount", "E20"), plan_loaded * 12, "annualized run-rate", 6.0)

    # January ramp: only roles with start month 1 are paid.
    jan_expected = 0.0
    dec_expected = 0.0
    for r in range(hc["plan_first"], hc["plan_last"] + 1):
        start_m = int(num("Headcount", f"C{r}"))
        fte = num("Headcount", f"D{r}")
        cost = num("Headcount", f"E{r}")
        load = num("Headcount", f"F{r}")
        if start_m <= 1:
            jan_expected += fte * cost * load
        dec_expected += fte * cost * load
    expect(num("Headcount", f"B{hc['cost_total']}"), jan_expected,
           "January people cost", 0.5)
    expect(num("Headcount", f"M{hc['cost_total']}"), dec_expected,
           "December people cost (full ramp)", 0.5)

    # Scenario rows must be the plan scaled by the documented multipliers.
    base_cost = dec_expected
    up_mult = num("Assumptions", f"C{asm['drivers']['first'] + 3}")
    dn_mult = num("Assumptions", f"D{asm['drivers']['first'] + 3}")
    expect(num("Headcount", f"M{hc['scenario_base']}"), base_cost, "Base cost row", 0.5)
    expect(num("Headcount", f"M{hc['scenario_upside']}"), base_cost * up_mult,
           "Upside cost row", 0.5)
    expect(num("Headcount", f"M{hc['scenario_downside']}"), base_cost * dn_mult,
           "Downside cost row", 0.5)
    observations.append(f"headcount {plan_fte:.1f} FTE, loaded ${plan_loaded:,.0f}/mo")

    # ---------------------------------------------------- rebuild each scenario
    driver_first = asm["drivers"]["first"]
    d_start = num("Assumptions", f"B{driver_first}")
    d_growth = num("Assumptions", f"B{driver_first + 1}")
    d_churn = num("Assumptions", f"B{driver_first + 2}")
    d_sm = num("Assumptions", f"B{driver_first + 4}")
    d_ga = num("Assumptions", f"B{driver_first + 5}")
    d_lag = int(num("Assumptions", f"B{driver_first + 6}"))
    d_capex = num("Assumptions", f"B{driver_first + 7}")
    opening = num("Assumptions", asm["opening_cash"])
    tax_rate = num("Assumptions", asm["tax_rate"])

    for name, tag in (("base", "B"), ("upside", "C"), ("downside", "D")):
        block = blocks[name]
        idx = driver_first
        g = num("Assumptions", f"{tag}{idx + 1}")
        c = num("Assumptions", f"{tag}{idx + 2}")
        sm = num("Assumptions", f"{tag}{idx + 4}")
        ga = num("Assumptions", f"{tag}{idx + 5}")
        lag = int(num("Assumptions", f"{tag}{idx + 6}"))
        capex = num("Assumptions", f"{tag}{idx + 7}")
        hc_row = hc[f"scenario_{name}"]

        seats = d_start
        revs: list[float] = []
        books = 0.0
        ebitdas = 0.0
        cash = opening
        for j in range(12):
            col = 2 + j
            new = seats * g
            churn = seats * c
            books += new * arpu * 12
            seats = seats + new - churn
            rev = seats * arpu
            revs.append(rev)

            people = num("Headcount", f"{chr(66 + j)}{hc_row}")
            opex = people + (new * arpu * 12) * sm + ga
            ebitda = rev - seats * cogs_seat - opex
            ebitdas += ebitda
            tax = max(0.0, ebitda) * tax_rate
            collected = revs[j - lag] if j >= lag else 0.0
            cash += collected - opex - rev * capex - tax

        expect(num("Model", f"M{block + rows['end']}"), seats,
               f"{name}: ending seats", 0.01)
        expect(num("Model", f"M{block + rows['ebitda']}"), ebitda,
               f"{name}: December EBITDA", 0.5)
        expect(num("Model", f"M{block + rows['end_cash']}"), cash,
               f"{name}: December cash", 0.5)

        # Row-level identities on the December column.
        expect(num("Model", f"M{block + rows['rev']}"), revs[-1],
               f"{name}: December revenue", 0.5)
        expect(num("Model", f"M{block + rows['gp']}"),
               revs[-1] - seats * cogs_seat, f"{name}: December gross profit", 0.5)

        # Summary comparison row must echo the block.
        cmp_row = s["comparison_section"] + 2 + ("base", "upside", "downside").index(name)
        expect(num("Summary", f"E{cmp_row}"), cash, f"{name}: comparison cash", 0.5)
        expect(num("Summary", f"F{cmp_row}"), seats, f"{name}: comparison seats", 0.01)

    # ------------------------------------------------------------- Summary ----
    expect(num("Summary", "B10"), num("Model", f"M{blocks['base'] + rows['end_cash']}"),
           "summary ending cash ties to Base model", 0.5)
    expect(num("Summary", f"C{s['outlook_total']}"), num("Summary", "B8"),
           "outlook revenue total ties to FY revenue KPI", 0.5)
    expect(num("Summary", f"D{s['outlook_total']}"), num("Summary", "B9"),
           "outlook EBITDA total ties to FY EBITDA KPI", 0.5)
    expect(num("Summary", f"E{s['outlook_total']}"),
           num("Model", f"M{blocks['base'] + rows['end_cash']}"),
           "outlook closing cash ties to model", 0.5)

    fy_rev = num("Summary", "B8")
    if fy_rev <= 0:
        fail(f"FY revenue is not positive: {fy_rev}")
    expect(num("Summary", "E9"), num("Model", f"M{blocks['base'] + rows['end']}"),
           "summary seats tie to model", 0.01)

    # Cash roll-forward across all three blocks.
    for name, block in blocks.items():
        net = sum(num("Model", f"{chr(66 + j)}{block + rows['net']}") for j in range(12))
        expect(num("Model", f"M{block + rows['end_cash']}"), opening + net,
               f"{name}: cash roll-forward", 0.5)

    # ------------------------------------------------ in-sheet integrity rows --
    for i in range(s["checks_count"]):
        r = s["checks_first"] + i
        label = cell("Summary", f"A{r}")
        verdict = cell("Summary", f"B{r}")
        if str(verdict).strip() != "OK":
            fail(f"integrity check {label!r} reads {verdict!r}")

    observations.append(f"FY revenue ${fy_rev:,.0f}")
    observations.append(f"FY EBITDA ${num('Summary','B9'):,.0f}")
    observations.append(f"ending cash ${num('Summary','B10'):,.0f}")

    print("--- observations ---")
    for line in observations:
        print("  ", line)

    if failures:
        print(f"\n--- {len(failures)} FAILURES ---")
        for line in failures:
            print("  ✗", line)
        return 1

    print("\nAll independent checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
