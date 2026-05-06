import envelope from "../data/envelope_defaults.json" with { type: "json" };
import fuels from "../data/fuel_prices.json" with { type: "json" };
import type {
  BuildingInputs,
  CurrentHeatingInputs,
  HeatDemandResult,
  Renovations,
  FuelType,
} from "./types.ts";

// Defaults match suissetec's efficiencyWithHeating values for newer/condensing boilers.
// For older boilers use the override on CurrentHeatingInputs.generatorEfficiency.
const DEFAULT_BOILER_EFFICIENCY: Record<FuelType, number> = {
  heating_oil: 0.90,
  natural_gas: 0.90,
  wood_pellets: 0.70,
  wood_logs: 0.70,
  wood_chips: 0.70,
  district_heating: 0.97,
  electricity: 0.93,
};

export function estimateHeatDemand(
  building: BuildingInputs,
  current?: CurrentHeatingInputs,
): HeatDemandResult {
  const dhw = dhwKwhPerYear(building.occupants);

  const fromConsumption = tryFromConsumption(building, current);
  if (fromConsumption) {
    fromConsumption.hotWaterKwh = dhw;
    fromConsumption.spaceHeatingKwh = Math.max(0, fromConsumption.annualKwh - dhw);
    return fromConsumption;
  }

  const fromEnvelope = fromEnvelopeModel(building, dhw);
  if (fromEnvelope) return fromEnvelope;

  return fromRuleOfThumb(building, dhw);
}

function tryFromConsumption(
  building: BuildingInputs,
  current?: CurrentHeatingInputs,
): HeatDemandResult | null {
  if (!current?.fuelType) return null;

  const fuel = fuels.fuels[current.fuelType];
  const efficiency = current.generatorEfficiency ?? DEFAULT_BOILER_EFFICIENCY[current.fuelType];

  if (current.annualConsumption && current.annualConsumption > 0) {
    const finalEnergyKwh = current.annualConsumption * fuel.calorificKwhPerUnit;
    const usefulKwh = finalEnergyKwh * efficiency;
    return {
      method: "consumption_quantity",
      annualKwh: round1(usefulKwh),
      spaceHeatingKwh: 0,
      hotWaterKwh: 0,
      confidence: "high",
      notes: [
        `Berechnet aus ${current.annualConsumption} ${fuel.unit} × ${fuel.calorificKwhPerUnit} kWh/${fuel.unit} × Wirkungsgrad ${efficiency}.`,
      ],
    };
  }

  if (current.annualCostChf && current.annualCostChf > 0) {
    const pricePerUnit =
      "retailPriceChfPerUnit" in fuel
        ? (fuel as { retailPriceChfPerUnit: number }).retailPriceChfPerUnit
        : (fuel as { retailPriceChfPerKwh: number }).retailPriceChfPerKwh;
    if (!pricePerUnit) return null;
    const quantity = current.annualCostChf / pricePerUnit;
    const finalEnergyKwh = quantity * fuel.calorificKwhPerUnit;
    const usefulKwh = finalEnergyKwh * efficiency;
    return {
      method: "consumption_cost",
      annualKwh: round1(usefulKwh),
      spaceHeatingKwh: 0,
      hotWaterKwh: 0,
      confidence: "high",
      notes: [
        `Hergeleitet aus jährlichen Kosten ${current.annualCostChf} CHF bei Referenzpreis ${pricePerUnit} CHF/${fuel.unit}.`,
        "Die tatsächliche Genauigkeit hängt vom aktuellen Marktpreis ab.",
      ],
    };
  }

  return null;
}

function fromEnvelopeModel(
  building: BuildingInputs,
  dhwKwh: number,
): HeatDemandResult | null {
  if (!building.yearBuilt || !building.heatedAreaM2) return null;

  const baseKwhPerM2 = baseDemandForYear(building.yearBuilt, building.minergieStandard);
  const renovationFactor = renovationMultiplier(building.renovations);
  const typeFactor = building.buildingType
    ? envelope.buildingTypeFactor[building.buildingType]
    : 1.0;

  const spaceHeating = baseKwhPerM2 * renovationFactor * typeFactor * building.heatedAreaM2;
  const total = spaceHeating + dhwKwh;

  return {
    method: "envelope",
    annualKwh: round1(total),
    spaceHeatingKwh: round1(spaceHeating),
    hotWaterKwh: dhwKwh,
    confidence: "medium",
    notes: [
      `Baujahr ${building.yearBuilt}: Basisbedarf ${baseKwhPerM2} kWh/m²·a.`,
      renovationFactor < 0.99
        ? `Sanierungen reduzieren den Hüllverlust um ${Math.round((1 - renovationFactor) * 100)} %.`
        : "Keine Sanierungen berücksichtigt.",
      `Beheizte Fläche: ${building.heatedAreaM2} m².`,
    ],
  };
}

function fromRuleOfThumb(building: BuildingInputs, dhwKwh: number): HeatDemandResult {
  const wPerM2 = pickRuleOfThumb(building.yearBuilt, building.renovations);
  const peakLoadKw = (wPerM2 * building.heatedAreaM2) / 1000;
  const fullLoadHours = 1800;
  const spaceHeating = peakLoadKw * fullLoadHours;
  const total = spaceHeating + dhwKwh;

  return {
    method: "rule_of_thumb",
    annualKwh: round1(total),
    spaceHeatingKwh: round1(spaceHeating),
    hotWaterKwh: dhwKwh,
    confidence: "low",
    notes: [
      `Faustregel: ${wPerM2} W/m² × ${building.heatedAreaM2} m² × ${fullLoadHours} Volllaststunden.`,
      "Sehr grobe Näherung. Sobald Verbrauchs- oder Hülldaten vorliegen, neu berechnen.",
    ],
  };
}

function baseDemandForYear(year: number, minergie?: "minergie" | "minergie_p"): number {
  if (minergie === "minergie_p") return envelope.minergieKwhPerM2Year.minergie_p;
  if (minergie === "minergie") return envelope.minergieKwhPerM2Year.minergie;
  for (const era of envelope.buildEras) {
    if (year <= era.yearMax) return era.kwhPerM2Year;
  }
  return envelope.buildEras[envelope.buildEras.length - 1].kwhPerM2Year;
}

function renovationMultiplier(reno?: Renovations): number {
  if (!reno) return 1.0;
  const shares = envelope.envelopeLossShares;
  const impact = envelope.renovationImpact;

  let factor = shares.ventilationInfiltration;
  for (const component of ["walls", "roof", "windows", "cellar"] as const) {
    const era = reno[component] ?? "original";
    const reduction = impact[component][era];
    factor += shares[component] * reduction;
  }
  return factor;
}

function pickRuleOfThumb(year: number, reno?: Renovations): number {
  const t = envelope.ruleOfThumbWPerM2;
  const hasMajorReno = reno
    ? Object.values(reno).some((era) => era && era !== "original")
    : false;
  if (year < 1980) return hasMajorReno ? t.vor_1980_teilsaniert : t.vor_1980_unrenoviert;
  if (year < 2000) return t["1980_2000"];
  if (year < 2010) return t["2000_2010"];
  if (year < 2020) return t["2010_plus"];
  return t.minergie;
}

function dhwKwhPerYear(occupants?: number): number {
  if (!occupants || occupants <= 0) return 0;
  return occupants * envelope.domesticHotWater.kwhPerPersonYear;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
