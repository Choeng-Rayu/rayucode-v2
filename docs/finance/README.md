# Financial Budget & Forecast — FY2027

`RayuCode_Financial_Budget_FY2027.xlsx` is a formula-driven, four-tab budget
model. Every computed cell is a live Excel formula; there are no hard-coded
totals, so changing an input recalculates the whole workbook.

## What is real, and what is not

This model was built from **repository configuration only**. It is not built
from audited financials, because none exist in this repository.

| Item | Status | Where it comes from |
| --- | --- | --- |
| Model unit costs (per MTok) | **Available** | `crates/rayucode-provider-core/src/pricing.rs` |
| Plan reference prices | **Available (anchors)** | same file, `anthropic_oauth_pricing` / `openai_oauth_pricing` |
| RayuCode list prices | **Not in repository** | must be supplied from rayucode.com/plans |
| Bookings, revenue, cash | **Not available** | model inputs on `Assumptions` |
| Headcount and payroll | **Not available** | model inputs on `Headcount` |
| Compute credit dollar rate | **Not published** | `docs/REMOTE_COMPILE.md` — operator-set ledger units |
| Tokens per seat per month | **Not available** | model input on `Assumptions` |

The $20 / $100 / $200 tier prices are **Claude and ChatGPT reference plans**,
used only as anchors for a blended ARPU. They are not RayuCode list prices.
Replace `Assumptions!B17:C19` with the real tiers before using this for
planning.

## Tabs

**Summary** — the only tab most readers need.

- `B4` is a Base / Upside / Downside dropdown. It drives every selected-scenario
  figure through `CHOOSE(MATCH(...))`, including the whole monthly outlook.
- Key metrics: FY bookings (ACV), FY recognized revenue, FY EBITDA, ending cash,
  plus gross margin, EBITDA margin, ending seats and blended ARPU.
- Monthly outlook: bookings, recognized revenue, EBITDA, ending cash, paid seats.
- A scenario comparison table reads all three cases at once, independent of the
  dropdown selection.
- Integrity checks must all read `OK`; any `CHECK` means a formula broke.

**Assumptions** — every model input, grouped into six sections: model settings,
pricing tiers, scenario drivers, unit costs, usage per seat, and a source
register. Blue cells are inputs; green cells are formulas.

**Headcount** — a 12-role plan with start month, FTE, monthly base and load
factor. Two formula grids derive the monthly FTE ramp and the monthly fully
loaded cost, gated on each role's start month. Upside and Downside scale the
same role plan by the scenario headcount multiplier, so no roles are invented.

**Model** — three independent monthly blocks (Base, Upside, Downside) covering
seats, bookings, revenue, COGS, gross profit, opex, EBITDA, tax, lagged
collections, capex and a cash roll-forward.

## How the numbers connect

```
tier prices x mix            -> blended ARPU (Assumptions B21)
per-MTok rates x routing     -> blended input/output/cache rates
tokens per seat x rates      -> inference COGS per seat
inference + credits          -> total COGS per seat (B51)
COGS per seat vs ARPU        -> gross margin (B52)

starting seats x growth      -> new seats -> bookings (new x ARPU x 12)
starting seats x churn       -> churned seats -> ending seats
ending seats x ARPU          -> recognized revenue
revenue - COGS               -> gross profit
gross profit - people - S&M - G&A -> EBITDA
collections(lagged) - opex - capex - tax -> net cash change
opening cash + net change    -> ending cash
```

Revenue is recognized from ending seats, while bookings are the annual contract
value of new seats. That is why the two differ by more than a factor of twelve.
A deferred-revenue balance is deliberately **not** shown: with an ACV bookings
basis and MRR-based revenue, an unearned balance would not be well defined
without a billing-term assumption.

## Regenerating and verifying

```bash
python3 scripts/finance/build_financial_budget.py
$RAYU_SCRATCH_DIR/xlsxverify/bin/python scripts/finance/verify_budget.py
```

The builder writes the workbook plus `model-anchors.json`, which publishes the
generated row and column layout so the verifier never hard-codes a position.

The verifier recalculates the saved workbook with a separate formula engine
(`formulas`, not openpyxl), sweeps for `#VALUE!`-class errors, and rebuilds each
scenario from inputs read out of the workbook itself:

- blended ARPU and COGS per seat recomputed from tier and rate tables
- ending seats, December revenue, EBITDA and cash rebuilt month by month
- cash roll-forward checked as opening + sum of net changes
- summary KPIs tied to the underlying model rows
- all in-sheet integrity checks asserted to read `OK`

To create the verifier environment:

```bash
python3 -m venv "$RAYU_SCRATCH_DIR/xlsxverify"
"$RAYU_SCRATCH_DIR/xlsxverify/bin/pip" install formulas openpyxl
```

## Known limitations

- Growth and churn are applied to starting seats each month, so the model is a
  simple compounding ramp, not a cohort retention curve.
- Collections lag is a single DSO proxy per scenario, not an AR aging schedule.
- Tax applies only to positive monthly EBITDA; no loss carryforward is modelled.
- Opening cash, headcount costs and per-seat token usage are judgement inputs,
  not repository facts, and are labelled as such in the workbook.
