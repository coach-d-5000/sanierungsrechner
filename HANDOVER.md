# Sanierungsrechner — Handover

Heat-pump replacement calculator for St. Gallen. Built as a sandbox so far. Now needs your input on how to pull it into the existing 100in100 stack.

**TL;DR:** Backend works end-to-end (heat-demand model, suissetec proxy with PDF, GWR address lookup, Sonnendach roof scanner). UI scaffolded in Lovable as a hidden page with mock data. There's also a working sandbox UI at `localhost:8787` that combines map + GWR + Sonnendach for sales testing. Three integration decisions are waiting for you. Dominik will execute whatever you decide.

---

## What you need to decide

These are blocking the next step. None require code from you — just a call.

1. **Where does this code live in git?** Options:
   - New repo (e.g. `100in100/sanierungsrechner`) — clean separation, easier permissions
   - Folder in the existing 100in100 repo (e.g. `apps/sanierungsrechner/`) — single deploy pipeline
   - Folder in the existing Lovable repo — tightest integration, Lovable picks it up automatically
2. **Edge Function deploy structure** — pick one (details below):
   - **Option A**: keep `model/` and `data/` at root, run a small bundle script before each deploy
   - **Option B**: move `model/` and `data/` under `supabase/functions/_shared/sanierungsrechner/`, deploy works out of the box
3. **Go-live timing** — Lovable page is currently hidden, mock data only. When do we point it at the real backend? (Recommend: after you've reviewed one full request/response cycle locally.)

Once decided, it's a half-day of execution.

---

## What's running today

### The model (TypeScript, pure functions)

Inputs: building year, heated area, occupants, distribution type, fuel + consumption (or cost, or estimate from envelope).
Outputs: heat demand kWh, recommended pump model from a 14-model catalog, JAZ, electricity demand, costs, CO₂, borehole length for brine, full economic stack (subsidies → tax → value uplift), annual benefits (heating + service savings + CO₂), 50-year lifecycle projection.

Calibrated against suissetec's official calculator — output matches within ~6% (consistent low-side; the gap is HDD-normalization, predictable and acceptable for a pre-step approximation).

Numbers in the catalog and rules:

- **Heat pumps**: Optiheat Terra All-in-One (Sole, 6s/9s/12s) and Viessmann Vitocal 250-A (Air, 04/06/08/10/13/16/19). Real datasheet values for SCOP, COP at A2/A7/A−7/W35/W55, rated kW.
- **Install costs (turnkey, your numbers)**: 39'000 CHF air, 61'000 CHF brine.
- **Subsidies**: federal/cantonal flat (5'300 air / 8'500 brine) + Stadt SG per-meter borehole (1'000 + 40 CHF/m, capped at 250m EFH = 11'000 CHF max). Air gets nothing from the city — explicit policy.
- **Borehole rule**: 33 m/kW power-method × 80 kWh/m·a energy-method, averaged. Reflects post-2021 SIA 384/6 in dense urban areas.
- **Tax**: 18% Grenzsteuersatz applied to (turnkey − subsidies), per DBG Art. 32.
- **Value uplift**: 1:1 with investment, configurable.
- **Full-load hours St. Gallen**: 2'550 (calibrated against suissetec's own response for climate region 31).
- **Heating oil price**: 1.35 CHF/L end-customer (AvEnergy 2026 spot, rounded down).
- **Natural gas price**: 0.125 CHF/kWh (sgsw 2026 Tarif Basis, all-in incl. fix).
- **Electricity price**: 0.30 CHF/kWh (sgsw Tarif K Basis, blended HT/NT for typical WP load. Note: sgsw doesn't currently offer a separate WP-Sondertarif on the public tariff page. Worth a call to sgsw — Jan 2026 flexibility regulation could change this.)
- **Replacement cost (after year 20)**: 32'000 CHF for both pump types — same hardware-only cost since drilling/foundation already exists.
- **Lifetime**: pump 20 years, borehole 50+ years (PE-100 per SIA 384/6).
- **Lifecycle horizon**: 50 years, no inflation modeled (intentionally — keeps comparisons honest, no fuel gets advantaged).
- **Service costs (per EnergieSchweiz)**: oil 550 CHF/yr, gas 300, pellets 450, heat pump 250.

### The result screen layout (after redesign)

The right side of Block C used to show "Amortisation" timelines — that's been removed because it shifts the customer to a "make money on heating" mindset, which isn't the right pitch.

Now the layout is:

**Left column — Investitionsstack:**
```
Investition (brutto)        61'000 CHF
− Förderung gesamt         −18'140 CHF
= Investition netto         42'860 CHF
− Steuerersparnis (18 %)   −7'715 CHF
= Effektive Kosten          35'145 CHF
− Wertsteigerung (~1:1)    −61'000 CHF
= Wirtschaftliche Position −25'855 CHF   (highlighted green if negative)
```

**Right column — Sie sparen jedes Jahr:**
```
Heizkosten                  1'373 CHF/a
Servicekosten                 300 CHF/a
─────────────────────────
Summe Geld                  1'673 CHF/a

CO₂-Einsparung              5'618 kg/a
```

Plus the lifetime block (pump ~20 J., Erdsonde 50+ J. for brine; just one line for air) and a collapsible 50-year lifecycle comparison (capex + electricity over 50 years for both options, no inflation, both come out roughly equal — discussion topic for the consultation, not for the calculator output).

The `payback` field is still computed in the data and available for downstream use (e.g. the consultation handout) — UI just doesn't render it.

### The suissetec proxy

Reverse-engineered their `/api/calculate` endpoint. We send our input, they return either:
- JSON with structured numbers + a UUID (for retrieval later)
- The official PDF (`Accept: application/pdf`)

Handles both their request schemas (cat-1 fuels like oil/pellets need 3+ year entries; cat-2 like gas/electricity need period-based entries). Single-year customer input is auto-padded for cat-1.

Sends `futureHeatGeneration: "YES"` and `futureHeatGenerationWithWaterHeating` so the PDF doesn't show unresolved i18n placeholders ("report.futureHeatGenerationType.").

The PDF that comes back is the one a customer would receive from suissetec's own UI — verbatim, no modifications. Use case: official-quality output for cases where it's mandatory.

Sample PDFs in `e2e/out/` for four scenarios.

### GWR address lookup

Type a SG address → returns the building's GWR record decoded against the official BFS Merkmalskatalog v4.2: year built, floors, dwellings, ground area, heating system, energy source, warm-water system. Pre-fills the calculator form.

Smart warnings:
- Non-residential building (office, commercial) → flagged
- Missing energy reference area → estimated from `garea × floors × 0.85`, marked for verification
- Already on a heat pump → flagged
- Already on Fernwärme → flagged (relevant for SG city subsidy rules)

Tested against three real SG addresses (Rorschacher 150, Vadianstrasse 8, Fürstenlandstrasse 5) — all decoded correctly.

### Sandbox UI (`localhost:8787`)

A small standalone HTML/Leaflet app for sales testing — not the customer-facing Lovable page. Combines:
- swisstopo basemap (Karte / Luftbild toggle)
- Sonnendach overlay (BFE solar potential per roof segment)
- GWR overlay
- Address search (autocomplete via our `/gwr/search`)
- **Click-to-identify**: tap any roof → identifies GWR building + Sonnendach segment, adds to selection, polygon highlighted on map
- **Quick-add per direction**: after first click, buttons appear for "+ Alle S" / "+ Alle SO" / etc., showing count, area, kWh per direction. Plus "+ Alle Flächen dieses Gebäudes" for one-click full-roof selection.
- **Live aggregate**: total kWp, area, orientation breakdown, Pronovo Einmalvergütung estimate (200 CHF Grundbeitrag if ≥5 kWp + 280 CHF/kWp Leistungsbeitrag), sgsw Rückliefervergütung (10.6 Rp./kWh, both 100% and realistic 30% feed-in scenarios)
- Mobile/tablet-friendly: no shift-click required, every tap adds to selection, ↻ button clears

The sandbox uses local coordinate conversion (no API roundtrips) and `sr=2056` on identify calls. **Important gotcha**: omitting `sr=2056` makes the geo.admin identify endpoint silently return zero features — it interprets LV95 coords as Web Mercator. Cost a couple hours to figure out; documented in the sandbox source.

Useful for in-person customer meetings: open `http://localhost:8787` on a tablet, type the address, tap roof segments, instantly see solar potential + subsidy estimate.

### Dev server + Edge Function

Same code, two runtimes:
- `server/dev.ts` — Node HTTP server, runs locally on port 8787. Also serves the sandbox HTML at `/` so just opening `http://localhost:8787` shows the UI.
- `supabase/functions/sanierung-estimate/index.ts` — Deno, deploy-ready for Supabase

API endpoints (both):
- `POST /estimate` — single scenario
- `POST /estimate-both` — both brine + air, side-by-side comparison
- `GET /gwr/search?q=<address>` — address autocomplete
- `GET /gwr/lookup?q=<address>` — first match + full prefill + warnings
- `GET /gwr/feature/<EGID>_<EDID>` — direct fetch by EGID
- `POST /suissetec/calculate` — proxy to suissetec, returns JSON + UUID
- `POST /suissetec/pdf` — proxy to suissetec, returns the official PDF

### The Lovable UI

Hidden page at `/sanierungsrechner` in the existing Lovable project. Three-step flow (address → questions → result), built with the existing shadcn/ui + Tailwind theme (read-only consumer of the design system, no shared files modified). Currently fetches `/sanierungsrechner-mock.json` as a stub.

Architecture: feature module under `src/lib/sanierungsrechner/` and `src/components/sanierungsrechner/`. Embedded mode prop is built in for future use (e.g. embedding in a customer detail page later).

Going live = swapping `api.ts` (one file) to call the deployed Edge Function.

---

## How to take it over

### Step 1 — Get the code

The repo currently lives locally on Dominik's machine. Three options, your call:

**a) New standalone GitHub repo.** Cleanest. Dominik creates the repo, you get push access.
**b) Folder in your existing 100in100 repo.** PR with the full tree under `apps/sanierungsrechner/` or similar.
**c) Direct into the Lovable repo.** Add `model/`, `data/`, `supabase/` folders alongside the existing `src/`.

Recommended: **(a)** for now — keeps the calculator independently deployable. Move into the main repo later if it makes sense.

### Step 2 — Pick the Edge Function deploy structure

The Edge Function imports `model/*.ts` and `data/*.json`. Supabase only ships the contents of `supabase/functions/<function-name>/` plus `supabase/functions/_shared/`. Two ways to handle it:

**Option A — Bundle script (current state).**
- `model/` and `data/` stay at repo root
- `scripts/deploy-edge.sh` (Dominik will write) copies them into the function folder, rewrites imports, deploys, cleans up
- Pros: dev/test paths stay readable
- Cons: deploy needs the script, easy to forget when doing it manually

**Option B — Restructure to `_shared`.**
- Move `model/` → `supabase/functions/_shared/sanierungsrechner/model/`
- Move `data/` → `supabase/functions/_shared/sanierungsrechner/data/`
- Update imports across `server/dev.ts`, `e2e/run.ts`, `supabase/functions/sanierung-estimate/index.ts`
- Pros: `supabase functions deploy` just works, no script
- Cons: longer relative paths in non-Supabase code

Recommended: **B**. One-time pain, cleaner forever. Half hour of edits.

### Step 3 — Deploy the Edge Function

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy sanierung-estimate
```

Function URL: `https://<project-ref>.supabase.co/functions/v1/sanierung-estimate/<endpoint>`

Verify with curl:
```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/sanierung-estimate/estimate-both" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <anon-key>" \
  -d '{"building":{"yearBuilt":1965,"heatedAreaM2":150,"distribution":"radiators"},"current":{"fuelType":"heating_oil","annualConsumption":2200}}'
```

### Step 4 — Wire Lovable to the live backend

Two prompts to paste into Lovable, one at a time:

**Prompt 1 — Replace the mock with the real call:**
```
Update src/lib/sanierungsrechner/api.ts so estimate() and estimateBoth()
POST to the Supabase Edge Function instead of fetching the mock JSON.

- Endpoint base: ${VITE_SUPABASE_URL}/functions/v1/sanierung-estimate
- Authorization: Bearer ${VITE_SUPABASE_ANON_KEY}
- Path for estimateBoth: /estimate-both
- Add gwrLookup(address) that GETs /gwr/lookup?q=<encoded address>
- Keep the existing types unchanged.
- If VITE_SUPABASE_URL is not set, fall back to the mock JSON for local dev.
- Do not modify any other file.
```

**Prompt 2 — Wire address autocomplete:**
```
In Step 1 of the Sanierungsrechner, replace the plain address input with a
debounced search using gwrLookup() from api.ts. Show matches in a dropdown.
On select, store the prefill values in form state and skip to Step 2 with
fields pre-populated. Show the warnings array from the response in a yellow
notice card above the form. Do not modify any other component.
```

That's the full path to live.

### Step 5 — Result screen layout (already deployed in Lovable mock)

The Lovable UI as currently built reflects the post-redesign layout:
- Block C **left**: investment stack including Wertsteigerung (1:1) line
- Block C **right**: "Sie sparen jedes Jahr" with heating + service + CO₂ totals
- Lifetime block: pump 20 J. / Erdsonde 50+ J. for brine
- Collapsible "Langfrist-Vergleich über 50 Jahre" expandable section

If a Lovable rebuild ever drops these, the prompt to restore them is in the project history. Mock JSON in `public/sanierungsrechner-mock.json` matches the canonical 1965 EFH 2'200 L oil scenario with corrected fuel prices.

---

## Open items

Rough effort estimates and priorities. None are blockers for v1 going live.

| Item | Effort | Priority | Notes |
|------|--------|----------|-------|
| Wärmeverbund-Zonen check for SG | ~1d | Medium | City has its own GIS at `map.stadt.sg.ch`, no federal layer. v1 uses a manual checkbox; auto-detection v2. |
| swisstopo map integration (in Lovable UI) | ~1d | Medium | Replace placeholder map in Step 1 with real swisstopo tiles. Sandbox already has the working pattern — port it over. |
| PDF storage to Supabase bucket | ~half-day | Medium | When a customer's official PDF is generated, store it. Needs bucket setup and customer-record linking. |
| Sonnendach in Lovable customer flow | ~half-day | Medium | Currently only in the sandbox. Bring the click-to-select roof + per-direction buttons into the customer-facing Lovable result screen, so customers see "your roof has X kWp potential, Y CHF subsidy". |
| Larger Optiheat models if needed | ~1h | Low | Current catalog covers up to 12 kW brine. For MFH/larger jobs we'd want 18s/24s. Send datasheets and Dominik adds them. |
| District heating (Fernwärme) flow | ~half-day | Low | Suissetec's API doesn't support it. Either skip the official PDF for those customers, or add our own simplified PDF generation. |
| Confirm sgsw WP-Sondertarif | ~10 min phone call | Low | If sgsw rolls out a Sperrzeit-Tarif post-Jan 2026 (likely 22–25 Rp./kWh), payback drops back into 20–25 year territory. |
| Embedding in customer detail page | depends | Future | The seam-point props are already built (`embedded`, `prefillCustomer`, `onComplete`). Just wire them when ready. |

---

## File map

```
data/                              JSON config, version-controlled
  fuels.json                       suissetec fuel catalog (mirror)
  heat_generators.json             suissetec generator catalog (mirror)
  heat_pumps.json                  our Optiheat + Viessmann catalog
  fuel_prices.json                 retail prices, calorific values, CO₂, service costs
  envelope.json                    SIA 380/1 reference values for heat demand
  borehole.json                    SIA 384/6 sizing rules
  installation_costs.json          turnkey + subsidy structure SG
  economics.json                   tax rate, value uplift, lifetime, replacement cost
  gwr_codes.json                   BFS Merkmalskatalog code mappings
  sample_suissetec_response.pdf    sample PDF for inspection

model/                             pure TS, framework-free
  types.ts                         input/output types
  heatDemand.ts                    consumption → kWh (envelope or measured)
  currentSystem.ts                 current fuel cost/CO₂ summary
  heatPumpProjection.ts            pump selection, JAZ, electricity
  borehole.ts                      sizing for brine
  installationEconomics.ts         install cost minus subsidies
  economicAnalysis.ts              tax + value uplift + benefits + lifecycle
  estimate.ts                      orchestrator (the one function the UI calls)
  suissetecProxy.ts                client for their official API
  gwrLookup.ts                     address → BFS record → prefill
  smoketest.ts                     run scenarios, print human-readable output

server/dev.ts                      Node HTTP server (also serves sandbox at /)
sandbox/index.html                 Standalone Leaflet UI for sales testing
supabase/functions/sanierung-estimate/index.ts   Deno, deploy target
e2e/run.ts                         live test against suissetec, parity table
e2e/out/                           saved real PDFs, JSON dumps
HANDOVER.md                        this file
```

## Useful commands

Run the smoke test (no network):
```bash
node --experimental-strip-types model/smoketest.ts
```

Run the e2e against suissetec (network):
```bash
node --experimental-strip-types e2e/run.ts
```

Start the dev server + sandbox UI:
```bash
node --experimental-strip-types server/dev.ts
# then open http://localhost:8787 (sandbox) or
# curl http://localhost:8787/health (API ping)
```

Free port if you get `EADDRINUSE`:
```bash
lsof -ti :8787 | xargs kill -9
```

## External dependencies (no auth needed)

- **suissetec API**: `https://burner-replacement.suissetec.ch/api/*` — public, no API key, soft rate limit unknown. We send minimal customer info as required by their schema. Worth a one-paragraph email to suissetec letting them know we're using it programmatically.
- **swisstopo geocoder + GWR + Sonnendach + Basemap**: `https://api3.geo.admin.ch/*` and `https://wmts.geo.admin.ch/*` — public, free for commercial use under Swiss OGD license. ~100 lookups/month is well within fair use. **Critical**: identify endpoint requires `sr=2056` parameter when sending LV95 coordinates, otherwise returns zero features silently.
- **Pronovo subsidy rates**: hardcoded in sandbox (`sandbox/index.html`) as 200 CHF Grundbeitrag + 280 CHF/kWp Leistungsbeitrag. Verify against [pronovo.ch/de/services/tarifrechner](https://pronovo.ch/de/services/tarifrechner/) before public launch.
- **sgsw Rückliefertarif**: 10.6 Rp./kWh (6.0 Bund-Min + 4.6 ökol. Mehrwert) — verify annually with sgsw.

## Contacts

- Dominik (this project): dominik@42hacks.com
- suissetec API contact: not yet established — recommend we do this before going live to a public landing page

---

Anything unclear, anything you'd structure differently, ping Dominik. Most decisions in this doc are reversible — start with the smallest set that gets you to live, iterate from there.
