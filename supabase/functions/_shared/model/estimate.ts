import { estimateHeatDemand } from "./heatDemand.ts";
import { describeCurrentSystem } from "./currentSystem.ts";
import { projectHeatPump } from "./heatPumpProjection.ts";
import { analyzeEconomics } from "./economicAnalysis.ts";
import type { EstimationInput, EstimationResult } from "./types.ts";

export interface EstimateOptions {
  marginalTaxRate?: number;
  houseValueUpliftFactor?: number;
}

export function estimate(
  input: EstimationInput,
  options: EstimateOptions = {},
): EstimationResult {
  const demand = estimateHeatDemand(input.building, input.current);
  const current = describeCurrentSystem(input.current);
  const distribution = input.building.distribution ?? "radiators";
  const pump = projectHeatPump(
    demand,
    distribution,
    input.scenario,
    input.electricityPriceChfPerKwh,
  );
  const { comparison, caveats } = analyzeEconomics(
    demand,
    pump,
    current,
    input.building.buildingType ?? "EFH",
    options,
  );

  return {
    heatDemand: demand,
    current,
    heatPump: pump,
    comparison,
    caveats: [
      ...caveats,
      "Schätzung basiert auf einem Verbrauchsjahr und öffentlichen Referenzwerten — kein Ersatz für eine suissetec-Detailberechnung.",
    ],
  };
}

export type { EstimationInput, EstimationResult };
