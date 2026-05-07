import costs from "../data/installation_costs.json" with { type: "json" };
import type { BuildingCategory, HeatSource } from "./types.ts";

export interface SubsidyBreakdown {
  total: number;
  flat: number;
  cityChf: number;
  cityMeters: number;
  cityMetersSubsidized: number;
  components: { name: string; chf: number }[];
}

export interface InstallationEconomics {
  source: HeatSource;
  turnkeyChf: number;
  subsidies: SubsidyBreakdown;
  netCostChf: number;
}

export function calculateEconomics(
  source: HeatSource,
  buildingType: BuildingCategory = "EFH",
  boreholeMeters?: number,
): InstallationEconomics {
  const turnkey = source === "brine" || source === "water"
    ? costs.turnkeyCostChf.brine
    : costs.turnkeyCostChf.air;

  const subsidies = source === "brine" || source === "water"
    ? brineSubsidies(buildingType, boreholeMeters ?? 0)
    : airSubsidies();

  return {
    source,
    turnkeyChf: turnkey,
    subsidies,
    netCostChf: turnkey - subsidies.total,
  };
}

function airSubsidies(): SubsidyBreakdown {
  return {
    total: costs.subsidies.air.flatChf,
    flat: costs.subsidies.air.flatChf,
    cityChf: 0,
    cityMeters: 0,
    cityMetersSubsidized: 0,
    components: [
      ...costs.subsidies.air.components,
      { name: "Stadt St. Gallen (Luft-WP nicht förderfähig)", chf: 0 },
    ],
  };
}

function brineSubsidies(buildingType: BuildingCategory, meters: number): SubsidyBreakdown {
  const flat = costs.subsidies.brine.flatChf;
  const cityCfg = costs.subsidies.brine.city[buildingType] ?? costs.subsidies.brine.city.EFH;
  const subsidizedMeters = Math.min(meters, cityCfg.maxMeters);
  const cityChf = cityCfg.baseChf + cityCfg.perMeterChf * subsidizedMeters;

  return {
    total: flat + cityChf,
    flat,
    cityChf,
    cityMeters: meters,
    cityMetersSubsidized: subsidizedMeters,
    components: [
      ...costs.subsidies.brine.components,
      {
        name: `Stadt St. Gallen (${cityCfg.baseChf} CHF + ${cityCfg.perMeterChf} CHF × ${subsidizedMeters} m)`,
        chf: cityChf,
      },
    ],
  };
}
