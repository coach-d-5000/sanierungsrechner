import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { estimate } from "../model/estimate.ts";
import {
  calculateViaSuissetec,
  fetchPdfFromInput,
  isSupportedBySuissetec,
  type SuissetecCalculationInput,
} from "../model/suissetecProxy.ts";
import type { EstimationInput, FuelType } from "../model/types.ts";

interface Scenario {
  label: string;
  estimationInput: EstimationInput;
  suissetecInput: Omit<SuissetecCalculationInput, "customer">;
}

const scenarios: Scenario[] = [
  {
    label: "1965-EFH-Oel-Radiatoren",
    estimationInput: {
      building: { yearBuilt: 1965, heatedAreaM2: 150, occupants: 4, buildingType: "EFH", distribution: "radiators" },
      current: { fuelType: "heating_oil", annualConsumption: 2200 },
      scenario: { source: "brine" },
    },
    suissetecInput: {
      climateRegionId: 31,
      fuelType: "heating_oil",
      oldGenerator: false,
      buildingType: "EFH",
      energyReferenceArea: 150,
      waterHeatingType: "WITH_HEATING",
      consumption: [{ date: "2024-12-31", quantity: 2200 }],
    },
  },
  {
    label: "1995-EFH-Gas-Bodenheizung",
    estimationInput: {
      building: { yearBuilt: 1995, heatedAreaM2: 180, occupants: 4, buildingType: "EFH", distribution: "underfloor" },
      current: { fuelType: "natural_gas", annualConsumption: 22000 },
      scenario: { source: "air" },
    },
    suissetecInput: {
      climateRegionId: 31,
      fuelType: "natural_gas",
      heatGeneratorIdOverride: 2,
      buildingType: "EFH",
      energyReferenceArea: 180,
      waterHeatingType: "WITH_HEATING",
      consumption: [{ date: "2024-12-31", quantity: 22000 }],
    },
  },
  {
    label: "2010-EFH-Pellets-Bodenheizung",
    estimationInput: {
      building: { yearBuilt: 2010, heatedAreaM2: 160, occupants: 3, buildingType: "EFH", distribution: "underfloor" },
      current: { fuelType: "wood_pellets", annualConsumption: 2500 },
      scenario: { source: "brine" },
    },
    suissetecInput: {
      climateRegionId: 31,
      fuelType: "wood_pellets",
      buildingType: "EFH",
      energyReferenceArea: 160,
      waterHeatingType: "WITH_HEATING",
      consumption: [{ date: "2024-12-31", quantity: 2500 }],
    },
  },
  {
    label: "1980-MFH-Oel-Radiatoren",
    estimationInput: {
      building: { yearBuilt: 1980, heatedAreaM2: 600, occupants: 12, buildingType: "MFH", distribution: "radiators" },
      current: { fuelType: "heating_oil", annualConsumption: 8500 },
      scenario: { source: "brine" },
    },
    suissetecInput: {
      climateRegionId: 31,
      fuelType: "heating_oil",
      buildingType: "MFH",
      energyReferenceArea: 600,
      waterHeatingType: "WITH_HEATING",
      consumption: [{ date: "2024-12-31", quantity: 8500 }],
    },
  },
];

const customer = {
  city: "St. Gallen",
  objectName: "Sanierungsrechner E2E Test",
  customerName: "100in100 Test",
  companyName: "100in100",
  plannerInstallerName: "100in100 System",
};

const outDir = join(import.meta.dirname!, "out");
mkdirSync(outDir, { recursive: true });

interface ParityRow {
  label: string;
  ourKwh: number;
  suissetecKwh: number;
  ourPeakKw: number;
  suissetecPeakKw: number;
  pdfPath: string;
  pdfBytes: number;
}

const parityRows: ParityRow[] = [];

for (const s of scenarios) {
  console.log(`\n──── ${s.label} ────`);

  const ours = estimate(s.estimationInput);
  console.log(`  Unser Modell: ${ours.heatDemand.annualKwh} kWh, Peak ${ours.heatPump.peakLoadKw} kW (${ours.heatPump.recommendedModelName}, JAZ ${ours.heatPump.jaz})`);

  if (!isSupportedBySuissetec(s.suissetecInput.fuelType)) {
    console.log(`  ⚠ ${s.suissetecInput.fuelType} wird von suissetec nicht unterstützt — übersprungen.`);
    continue;
  }

  try {
    const { json, pdfUrl } = await calculateViaSuissetec({ customer, ...s.suissetecInput });
    console.log(`  Suissetec : ${Math.round(json.useEnergy)} kWh useEnergy, ${json.heatingDemand} kW heatingDemand`);
    console.log(`              FullLoadHours ${json.fullLoadHours}, calorific ${json.calorificValue}, η ${json.heatGeneratorEfficacy}`);
    console.log(`              UUID ${json.uuid}`);
    console.log(`              Building type ECH: ${json.buildingTypePerformanceGuaranteeECH}`);

    const pdfBlob = await fetchPdfFromInput({ customer, ...s.suissetecInput });
    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());
    const pdfPath = join(outDir, `${s.label}.pdf`);
    writeFileSync(pdfPath, pdfBuffer);

    const jsonPath = join(outDir, `${s.label}.json`);
    writeFileSync(jsonPath, JSON.stringify({ ours, suissetec: json }, null, 2));

    parityRows.push({
      label: s.label,
      ourKwh: ours.heatDemand.annualKwh,
      suissetecKwh: Math.round(json.useEnergy),
      ourPeakKw: ours.heatPump.peakLoadKw,
      suissetecPeakKw: json.heatingDemand,
      pdfPath,
      pdfBytes: pdfBuffer.length,
    });

    console.log(`  ✓ PDF (${pdfBuffer.length} bytes) → ${pdfPath}`);
  } catch (err) {
    console.error(`  ✗ Fehler: ${(err as Error).message}`);
  }
}

console.log("\n══════ PARITY ══════");
console.log("Scenario                              Ours kWh   suissetec kWh   Δ%      Ours kW   suissetec kW   Δ%");
console.log("─".repeat(110));
for (const r of parityRows) {
  const dKwh = ((r.ourKwh - r.suissetecKwh) / r.suissetecKwh) * 100;
  const dKw = ((r.ourPeakKw - r.suissetecPeakKw) / r.suissetecPeakKw) * 100;
  console.log(
    `${r.label.padEnd(38)}  ${pad(r.ourKwh, 9)}   ${pad(r.suissetecKwh, 13)}   ${pct(dKwh, 6)}   ${pad(r.ourPeakKw, 7)}   ${pad(r.suissetecPeakKw, 12)}   ${pct(dKw, 6)}`,
  );
}

function pad(n: number, w: number): string { return String(n).padStart(w); }
function pct(n: number, w: number): string {
  const sign = n >= 0 ? "+" : "";
  return (sign + n.toFixed(1) + "%").padStart(w);
}
