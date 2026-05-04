import fuels from "../data/fuel_prices.json" with { type: "json" };
import type { CurrentHeatingInputs, CurrentSystemResult } from "./types.ts";

export function describeCurrentSystem(
  current: CurrentHeatingInputs | undefined,
): CurrentSystemResult | null {
  if (!current?.fuelType) return null;

  const fuel = fuels.fuels[current.fuelType];
  const pricePerUnit =
    "retailPriceChfPerUnit" in fuel
      ? (fuel as { retailPriceChfPerUnit: number }).retailPriceChfPerUnit
      : (fuel as { retailPriceChfPerKwh: number }).retailPriceChfPerKwh;

  let consumption: number | null = current.annualConsumption ?? null;
  let cost: number | null = current.annualCostChf ?? null;

  if (consumption && !cost) cost = consumption * pricePerUnit;
  if (cost && !consumption) consumption = cost / pricePerUnit;
  if (!consumption || !cost) return null;

  const finalEnergyKwh = consumption * fuel.calorificKwhPerUnit;
  const co2 = finalEnergyKwh * fuel.co2KgPerKwh;

  return {
    fuelType: current.fuelType,
    annualConsumption: round1(consumption),
    consumptionUnit: fuel.unit,
    annualCostChf: Math.round(cost),
    finalEnergyKwh: Math.round(finalEnergyKwh),
    co2KgPerYear: Math.round(co2),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
