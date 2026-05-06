import economics from "../data/economics.json" with { type: "json" };
import fuels from "../data/fuel_prices.json" with { type: "json" };
import { calculateEconomics } from "./installationEconomics.ts";
import type {
  AnnualBenefits,
  BuildingCategory,
  ComparisonResult,
  CurrentSystemResult,
  FuelType,
  HeatDemandResult,
  HeatPumpResult,
  PaybackPicture,
} from "./types.ts";

export interface EconomicAnalysisInput {
  marginalTaxRate?: number;
  houseValueUpliftFactor?: number;
}

export interface EconomicAnalysisOutput {
  comparison: ComparisonResult | null;
  caveats: string[];
}

export function analyzeEconomics(
  demand: HeatDemandResult,
  pump: HeatPumpResult,
  current: CurrentSystemResult | null,
  buildingType: BuildingCategory = "EFH",
  options: EconomicAnalysisInput = {},
): EconomicAnalysisOutput {
  const installation = calculateEconomics(pump.source, buildingType, pump.borehole?.meters);

  const caveats: string[] = [];
  if (demand.confidence === "low") {
    caveats.push("Wärmebedarf basiert auf Faustregel — Genauigkeit ±30 %.");
  } else if (demand.confidence === "medium") {
    caveats.push("Wärmebedarf basiert auf Hüllen-Modell — Genauigkeit ±25 %.");
  }
  if (pump.oversizedFactor > 1.5 || pump.oversizedFactor < 0.9) {
    caveats.push(`Modell-Auslegung ${pump.oversizedFactor}× — bei Detailplanung verifizieren.`);
  }
  if (pump.borehole && !pump.borehole.inTypicalEfhRange) {
    caveats.push(`Sondentiefe ${pump.borehole.meters} m liegt ausserhalb des typischen EFH-Bereichs — durch Bohrfirma prüfen.`);
  }

  if (!current) {
    return { comparison: null, caveats };
  }

  const annualSavings = current.annualCostChf - pump.annualCostChf;
  const annualSavingsPct = annualSavings / Math.max(current.annualCostChf, 1);
  const co2Savings = current.co2KgPerYear - pump.co2KgPerYear;

  const taxRate = options.marginalTaxRate ?? economics.marginalTaxRate;
  const upliftFactor = options.houseValueUpliftFactor ?? economics.houseValueUpliftFactor;

  const taxDeductible = Math.max(0, installation.turnkeyChf - installation.subsidies.total);
  const taxSaving = taxDeductible * taxRate;
  const valueUplift = installation.turnkeyChf * upliftFactor;

  const effectiveNetCost = installation.netCostChf - taxSaving;
  const effectiveAfterValue = effectiveNetCost - valueUplift;

  const payback: PaybackPicture = {
    grossPaybackYears: yearsOrNull(installation.netCostChf, annualSavings),
    withTaxPaybackYears: yearsOrNull(effectiveNetCost, annualSavings),
    withTaxAndValueUpliftYears: effectiveAfterValue <= 0 ? 0 : yearsOrNull(effectiveAfterValue, annualSavings),
    taxSavingChf: Math.round(taxSaving),
    valueUpliftChf: Math.round(valueUplift),
    taxDeductibleChf: Math.round(taxDeductible),
    effectiveNetCostChf: Math.round(effectiveNetCost),
    effectiveNetCostAfterValueUpliftChf: Math.round(effectiveAfterValue),
  };

  const benefits = buildBenefits(current, pump, annualSavings, co2Savings);

  const comparison: ComparisonResult = {
    annualSavingsChf: Math.round(annualSavings),
    annualSavingsPct: Math.round(annualSavingsPct * 100) / 100,
    co2SavingsKgPerYear: Math.round(co2Savings),
    installation,
    payback,
    lifetime: buildLifetime(pump.source),
    lifecycle: buildLifecycle(installation.netCostChf, pump.annualCostChf, pump.source),
    benefits,
  };

  return { comparison, caveats };
}

function buildBenefits(
  current: CurrentSystemResult,
  pump: HeatPumpResult,
  heatingCostSavings: number,
  co2Savings: number,
): AnnualBenefits {
  const fuelData = (fuels.fuels as Record<string, { annualServiceCostChf?: number }>)[current.fuelType];
  const currentService = fuelData?.annualServiceCostChf ?? 400;
  const newService = fuels.fuels.electricity.heatPumpAnnualServiceCostChf ?? 250;
  const serviceSaving = currentService - newService;
  return {
    heatingCostSavingChf: Math.round(heatingCostSavings),
    serviceCostSavingChf: Math.round(serviceSaving),
    co2SavingKg: Math.round(co2Savings),
    totalCashSavingChf: Math.round(heatingCostSavings + serviceSaving),
    currentServiceCostChf: currentService,
    newServiceCostChf: newService,
  };
}

function buildLifecycle(
  initialNetCost: number,
  annualElectricityCost: number,
  source: "air" | "brine" | "water",
): import("./types.ts").LifecycleProjection {
  const horizon = economics.lifecycleHorizonYears;
  const pumpLifetime = economics.expectedPumpLifetimeYears;
  const replacementCost = source === "brine" || source === "water"
    ? economics.replacementCostChf.brine
    : economics.replacementCostChf.air;
  const inflation = economics.electricityPriceInflationRate;

  const replacements: number[] = [];
  for (let y = pumpLifetime; y < horizon; y += pumpLifetime) replacements.push(y);

  const capex = initialNetCost + replacements.length * replacementCost;
  // Geometric sum: Σ cost*(1+i)^t for t=0..horizon-1
  const electricityTotal = inflation === 0
    ? annualElectricityCost * horizon
    : annualElectricityCost * (Math.pow(1 + inflation, horizon) - 1) / inflation;

  return {
    horizonYears: horizon,
    replacementsAtYears: replacements,
    replacementCostChf: replacementCost,
    electricityInflationRate: inflation,
    capexChf: Math.round(capex),
    electricityChf: Math.round(electricityTotal),
    totalChf: Math.round(capex + electricityTotal),
    notes: [
      `Ersatz nach ${pumpLifetime} und ${pumpLifetime * 2} Jahren à ${replacementCost.toLocaleString("de-CH")} CHF (ohne Bohrung/Fundament).`,
      `Alle Preise nominal heutig — keine Inflation auf Strom oder fossile Energie modelliert. Bewusst konservativ.`,
      `Wartungskosten und Zinskosten nicht modelliert.`,
    ],
  };
}

function buildLifetime(source: "air" | "brine" | "water"): import("./types.ts").LifetimeView {
  const pumpYears = economics.expectedPumpLifetimeYears;
  if (source === "brine" || source === "water") {
    const bore = economics.expectedBoreholeLifetimeYears;
    return {
      pumpYears,
      boreholeYears: bore,
      display: [
        { label: "Wärmepumpe", years: `~${pumpYears} Jahre` },
        { label: "Erdsonde", years: `${bore}+ Jahre` },
      ],
      note: "Die Erdsonde übersteht 2–3 Wärmepumpen-Generationen. Bei einem späteren Ersatz der Anlage entfallen die Bohrkosten.",
    };
  }
  return {
    pumpYears,
    display: [{ label: "Anlage", years: `~${pumpYears} Jahre` }],
  };
}

function yearsOrNull(cost: number, annualSavings: number): number | null {
  if (annualSavings <= 0 || cost <= 0) return cost <= 0 ? 0 : null;
  return Math.round((cost / annualSavings) * 10) / 10;
}
