import borehole from "../data/borehole.json" with { type: "json" };

export interface BoreholeEstimate {
  meters: number;
  metersByEnergyMethod: number;
  metersByPowerMethod: number;
  inTypicalEfhRange: boolean;
  notes: string[];
}

export function estimateBoreholeMeters(
  annualHeatDemandKwh: number,
  jaz: number,
  heatPumpPeakKw: number,
): BoreholeEstimate {
  const extractionRatio = Math.max(0, 1 - 1 / Math.max(jaz, 1.5));
  const annualExtractionKwh = annualHeatDemandKwh * extractionRatio;

  const metersEnergy = annualExtractionKwh / borehole.specificExtractionEnergyKwhPerMeterYear;
  const metersPower = heatPumpPeakKw * borehole.powerRuleMetersPerKw;

  const meters = Math.max(
    borehole.minRealisticMeters,
    Math.round((metersEnergy + metersPower) / 2),
  );

  const range = borehole.typicalEfhRange;
  const notes: string[] = [
    `Energiemethode: ${Math.round(annualExtractionKwh)} kWh/a Entzug ÷ ${borehole.specificExtractionEnergyKwhPerMeterYear} kWh/m·a → ${Math.round(metersEnergy)} m.`,
    `Leistungsmethode: ${heatPumpPeakKw} kW × ${borehole.powerRuleMetersPerKw} m/kW → ${Math.round(metersPower)} m.`,
  ];
  if (metersEnergy < borehole.minRealisticMeters) {
    notes.push(`Rechnerisch unter ${borehole.minRealisticMeters} m — auf wirtschaftliches Minimum aufgerundet.`);
  }
  notes.push("Schätzung. Effektive Auslegung nach SIA 384/6 durch Bohrfirma.");

  return {
    meters,
    metersByEnergyMethod: Math.round(metersEnergy),
    metersByPowerMethod: Math.round(metersPower),
    inTypicalEfhRange: meters >= range.min && meters <= range.max,
    notes,
  };
}
