import heatPumps from "../data/heat_pumps.json" with { type: "json" };
import fuels from "../data/fuel_prices.json" with { type: "json" };
import { estimateBoreholeMeters } from "./borehole.ts";
import type {
  HeatDemandResult,
  HeatDistribution,
  HeatPumpResult,
  HeatPumpScenario,
  HeatSource,
} from "./types.ts";

interface HeatPumpModel {
  id: string;
  manufacturer: string;
  name: string;
  source: HeatSource;
  ratedKw: { W35: number; W55: number };
  scop: Record<string, number>;
}

// St. Gallen Volllaststunden: 2550. Bestätigt durch suissetec /api/calculate
// für Klimaregion id=31 (St. Gallen). Frühere Schätzung 1900 war zu niedrig.
const ST_GALLEN_FULL_LOAD_HOURS = 2550;

export function projectHeatPump(
  demand: HeatDemandResult,
  distribution: HeatDistribution,
  scenario?: HeatPumpScenario,
  electricityPriceChfPerKwh?: number,
): HeatPumpResult {
  const peakLoadKw = demand.annualKwh / ST_GALLEN_FULL_LOAD_HOURS;

  const candidates = (heatPumps.models as HeatPumpModel[]).filter((m) =>
    scenario?.source ? m.source === scenario.source : true,
  );

  const model = scenario?.modelId
    ? candidates.find((m) => m.id === scenario.modelId) ?? pickBestFit(candidates, peakLoadKw, distribution)
    : pickBestFit(candidates, peakLoadKw, distribution);

  if (!model) throw new Error("No heat pump candidate available");

  const jaz = realWorldJaz(model, distribution);
  const electricityKwh = demand.annualKwh / jaz;
  const price = electricityPriceChfPerKwh ?? fuels.fuels.electricity.heatPumpTariffChfPerKwh;
  const annualCost = electricityKwh * price;
  const co2 = electricityKwh * fuels.fuels.electricity.co2KgPerKwh;

  const sizingRefKw = distribution === "underfloor" ? model.ratedKw.W35 : model.ratedKw.W55;
  const oversized = sizingRefKw / Math.max(peakLoadKw, 0.1);

  const result: HeatPumpResult = {
    recommendedModelId: model.id,
    recommendedModelName: model.name,
    source: model.source,
    sizingKwAt35: model.ratedKw.W35,
    sizingKwAt55: model.ratedKw.W55,
    peakLoadKw: round2(peakLoadKw),
    jaz: round2(jaz),
    electricityKwhPerYear: Math.round(electricityKwh),
    annualCostChf: Math.round(annualCost),
    co2KgPerYear: Math.round(co2),
    oversizedFactor: round2(oversized),
  };

  if (model.source === "brine" || model.source === "water") {
    result.borehole = estimateBoreholeMeters(demand.annualKwh, jaz, peakLoadKw);
  }

  return result;
}

function pickBestFit(
  candidates: HeatPumpModel[],
  peakLoadKw: number,
  distribution: HeatDistribution,
): HeatPumpModel | undefined {
  const targetKw = peakLoadKw * 1.1;
  const refField: "W35" | "W55" = distribution === "underfloor" ? "W35" : "W55";

  const sorted = [...candidates].sort(
    (a, b) => a.ratedKw[refField] - b.ratedKw[refField],
  );
  return sorted.find((m) => m.ratedKw[refField] >= targetKw) ?? sorted[sorted.length - 1];
}

function realWorldJaz(model: HeatPumpModel, distribution: HeatDistribution): number {
  // Pick the SCOP key that matches distribution; brine pumps have B0_W35/B0_W55, air pumps have W35/W55.
  const isBrine = model.source === "brine" || model.source === "water";
  const scop = model.scop;

  let labScop: number;
  if (distribution === "underfloor") {
    labScop = isBrine ? scop.B0_W35 ?? scop.W35 : scop.W35;
  } else if (distribution === "radiators") {
    labScop = isBrine ? scop.B0_W55 ?? scop.W55 : scop.W55;
  } else {
    const lo = isBrine ? scop.B0_W35 ?? scop.W35 : scop.W35;
    const hi = isBrine ? scop.B0_W55 ?? scop.W55 : scop.W55;
    labScop = (lo + hi) / 2;
  }

  // Empirical St. Gallen derate: air-source loses ~8 % vs lab SCOP, brine ~3 %.
  const derate = model.source === "air" ? 0.92 : 0.97;
  return labScop * derate;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
