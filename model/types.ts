export type HeatDistribution = "underfloor" | "radiators" | "mixed";
export type HeatSource = "air" | "brine" | "water";

export type FuelType =
  | "heating_oil"
  | "natural_gas"
  | "wood_pellets"
  | "wood_logs"
  | "wood_chips"
  | "district_heating"
  | "electricity";

export type RenovationEra =
  | "original"
  | "1970s"
  | "1980s"
  | "1990s"
  | "2000s"
  | "2010s_plus";

export type BuildingCategory = "EFH" | "MFH" | "Reihenhaus";

export interface Renovations {
  roof?: RenovationEra;
  walls?: RenovationEra;
  windows?: RenovationEra;
  cellar?: RenovationEra;
}

export interface BuildingInputs {
  yearBuilt: number;
  heatedAreaM2: number;
  occupants?: number;
  buildingType?: BuildingCategory;
  renovations?: Renovations;
  distribution?: HeatDistribution;
  minergieStandard?: "minergie" | "minergie_p";
}

export interface CurrentHeatingInputs {
  fuelType?: FuelType;
  annualConsumption?: number;
  annualCostChf?: number;
  generatorEfficiency?: number;
}

export interface HeatPumpScenario {
  source?: HeatSource;
  modelId?: string;
}

export interface EstimationInput {
  building: BuildingInputs;
  current?: CurrentHeatingInputs;
  scenario?: HeatPumpScenario;
  electricityPriceChfPerKwh?: number;
}

export type DemandMethod = "consumption_cost" | "consumption_quantity" | "envelope" | "rule_of_thumb";
export type Confidence = "high" | "medium" | "low";

export interface HeatDemandResult {
  method: DemandMethod;
  annualKwh: number;
  spaceHeatingKwh: number;
  hotWaterKwh: number;
  confidence: Confidence;
  notes: string[];
}

export interface CurrentSystemResult {
  fuelType: FuelType;
  annualConsumption: number;
  consumptionUnit: string;
  annualCostChf: number;
  finalEnergyKwh: number;
  co2KgPerYear: number;
}

export interface HeatPumpResult {
  recommendedModelId: string;
  recommendedModelName: string;
  source: HeatSource;
  sizingKwAt35: number;
  sizingKwAt55: number;
  peakLoadKw: number;
  jaz: number;
  electricityKwhPerYear: number;
  annualCostChf: number;
  co2KgPerYear: number;
  oversizedFactor: number;
  borehole?: {
    meters: number;
    metersByEnergyMethod: number;
    metersByPowerMethod: number;
    inTypicalEfhRange: boolean;
    notes: string[];
  };
}

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

export interface PaybackPicture {
  grossPaybackYears: number | null;
  withTaxPaybackYears: number | null;
  withTaxAndValueUpliftYears: number | null;
  taxSavingChf: number;
  valueUpliftChf: number;
  taxDeductibleChf: number;
  effectiveNetCostChf: number;
  effectiveNetCostAfterValueUpliftChf: number;
}

export interface AnnualBenefits {
  heatingCostSavingChf: number;
  serviceCostSavingChf: number;
  co2SavingKg: number;
  totalCashSavingChf: number;
  currentServiceCostChf: number;
  newServiceCostChf: number;
}

export interface LifetimeView {
  pumpYears: number;
  boreholeYears?: number;
  display: { label: string; years: string }[];
  note?: string;
}

export interface LifecycleProjection {
  horizonYears: number;
  replacementsAtYears: number[];
  replacementCostChf: number;
  electricityInflationRate: number;
  capexChf: number;
  electricityChf: number;
  totalChf: number;
  notes: string[];
}

export interface ComparisonResult {
  annualSavingsChf: number;
  annualSavingsPct: number;
  co2SavingsKgPerYear: number;
  installation: InstallationEconomics;
  payback: PaybackPicture;
  lifetime: LifetimeView;
  lifecycle: LifecycleProjection;
  benefits: AnnualBenefits;
}

export interface EstimationResult {
  heatDemand: HeatDemandResult;
  current: CurrentSystemResult | null;
  heatPump: HeatPumpResult;
  comparison: ComparisonResult | null;
  caveats: string[];
}
