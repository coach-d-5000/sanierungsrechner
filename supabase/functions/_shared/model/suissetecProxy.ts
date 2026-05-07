// Proxy zur suissetec /api/calculate. Basiert auf reverse-engineering des Bundles
// und probieren der Endpunkte am 2026-04-28. Schema kann sich ändern.

import type { FuelType } from "./types.ts";

const API_BASE = "https://burner-replacement.suissetec.ch/api";

// Mapping unsere FuelType → suissetec fuel.id (verifiziert gegen data/fuels.json)
// fuel.id ist die Brennstoff+Einheit-Kombination, generator.id der Kesseltyp.
// Hinweis: suissetec hat KEINE Kategorie für "Fernwärme/district_heating" —
// in diesem Fall überspringen wir die suissetec-Berechnung.
interface FuelGeneratorMapping {
  fuelId: number;
  defaultGeneratorId: number;
  defaultGeneratorIdOldModel: number;
  // category 1 = point-in-time delivery records (oil, pellets, wood), needs 3+ entries
  // category 2 = period-based meter readings (gas, electricity), single entry works
  category: 1 | 2;
}

const FUEL_GENERATOR_MAP: Partial<Record<FuelType, FuelGeneratorMapping>> = {
  heating_oil:      { fuelId: 1,  defaultGeneratorId: 2, defaultGeneratorIdOldModel: 1, category: 1 },
  natural_gas:      { fuelId: 4,  defaultGeneratorId: 2, defaultGeneratorIdOldModel: 1, category: 2 },
  wood_pellets:     { fuelId: 14, defaultGeneratorId: 6, defaultGeneratorIdOldModel: 6, category: 1 },
  wood_logs:        { fuelId: 7,  defaultGeneratorId: 4, defaultGeneratorIdOldModel: 3, category: 1 },
  wood_chips:       { fuelId: 10, defaultGeneratorId: 5, defaultGeneratorIdOldModel: 5, category: 1 },
  electricity:      { fuelId: 16, defaultGeneratorId: 7, defaultGeneratorIdOldModel: 7, category: 2 },
  // district_heating: suissetec API unsupported
};

export function getFuelMapping(fuelType: FuelType): FuelGeneratorMapping | null {
  return FUEL_GENERATOR_MAP[fuelType] ?? null;
}

export function isSupportedBySuissetec(fuelType: FuelType): boolean {
  return fuelType in FUEL_GENERATOR_MAP;
}

export type SuissetecBuildingType = "EFH" | "MFH";
export type SuissetecWaterHeatingType = "WITH_HEATING" | "SEPARATE";

export interface SuissetecCustomerInfo {
  city: string;
  objectName: string;
  customerName: string;
  companyName: string;
  plannerInstallerName: string;
}

export interface SuissetecCalculationInput {
  customer: SuissetecCustomerInfo;
  climateRegionId: number;
  fuelType: FuelType;
  oldGenerator?: boolean;
  heatGeneratorIdOverride?: number;
  buildingType: SuissetecBuildingType;
  energyReferenceArea: number;
  waterHeatingType: SuissetecWaterHeatingType;
  consumption: { date: string; quantity: number }[];
}

export interface SuissetecCalculationResult {
  uuid: string;
  fullLoadHours: number;
  calorificValue: number;
  heatGeneratorEfficacy: number;
  endEnergy: number;
  useEnergy: number;
  heatingDemand: number;
  heatingDemandSpecific: number;
  hotWaterDeduction: number;
  requiredHeatOutputWithoutLock: number;
  requiredHeatOutputWithLock: number;
  buildingTypePerformanceGuaranteeECH: string;
  energyUseSummary: unknown;
}

export async function calculateViaSuissetec(
  input: SuissetecCalculationInput,
): Promise<{ json: SuissetecCalculationResult; pdfUrl: string }> {
  const body = buildRequestBody(input);

  const json = await postJson<SuissetecCalculationResult>(`${API_BASE}/calculate`, body);
  return { json, pdfUrl: `${API_BASE}/open/${json.uuid}` };
}

export async function fetchPdf(uuid: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/pdf" },
    body: JSON.stringify({ uuid }),
  });
  if (!res.ok) throw new Error(`Suissetec PDF fetch failed: HTTP ${res.status}`);
  return res.blob();
}

export async function fetchPdfFromInput(input: SuissetecCalculationInput): Promise<Blob> {
  const body = buildRequestBody(input);

  const res = await fetch(`${API_BASE}/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/pdf" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Suissetec PDF fetch failed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.blob();
}

function buildRequestBody(input: SuissetecCalculationInput): Record<string, unknown> {
  const mapping = getFuelMapping(input.fuelType);
  if (!mapping) throw new Error(`Brennstoff ${input.fuelType} wird von suissetec nicht unterstützt.`);
  const generatorId = input.heatGeneratorIdOverride
    ?? (input.oldGenerator ? mapping.defaultGeneratorIdOldModel : mapping.defaultGeneratorId);

  const base = {
    date: new Date().toISOString().slice(0, 10),
    climateRegion: `/api/climate_regions/${input.climateRegionId}`,
    fuel: `/api/fuels/${mapping.fuelId}`,
    heatGenerator: `/api/heat_generators/${generatorId}`,
    city: input.customer.city,
    objectName: input.customer.objectName,
    customerName: input.customer.customerName,
    companyName: input.customer.companyName,
    plannerInstallerName: input.customer.plannerInstallerName,
    buildingType: input.buildingType,
    energyReferenceArea: input.energyReferenceArea,
    waterHeatingType: input.waterHeatingType,
    // Behebt unaufgelöste i18n-Keys ("report.futureHeatGenerationType.") im PDF.
    // Im Sanierungsrechner-Kontext ist die Antwort immer ja: WP ersetzt fossiles
    // System inkl. Warmwasser. Falls das später konfigurierbar werden soll, hier
    // als Input-Felder durchreichen.
    futureHeatGeneration: "YES",
    futureHeatGenerationWithWaterHeating: input.waterHeatingType === "WITH_HEATING",
  };

  if (mapping.category === 1) {
    return { ...base, dataCategory1: ensureMinThreeYears(input.consumption), dataCategory2: [] };
  }
  return { ...base, dataCategory1: [], dataCategory2: toPeriodEntries(input.consumption) };
}

// Convert point-in-time entries to period entries for category-2 fuels.
// Each entry covers the calendar year ending on its date.
function toPeriodEntries(
  consumption: { date: string; quantity: number }[],
): { start: string; end: string; quantity: number }[] {
  return consumption.map((c) => {
    const end = new Date(c.date);
    const start = new Date(end);
    start.setFullYear(end.getFullYear() - 1);
    start.setDate(start.getDate() + 1);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      quantity: c.quantity,
    };
  });
}

// Suissetec verlangt mehrere Verbrauchsjahre. Bei nur einem Jahr duplizieren wir
// auf 3 Einträge mit verteilten Daten — der Server normalisiert per HDD.
function ensureMinThreeYears(
  consumption: { date: string; quantity: number }[],
): { date: string; quantity: number }[] {
  if (consumption.length >= 3) return consumption;
  if (consumption.length === 0) throw new Error("Keine Verbrauchsdaten vorhanden");

  const last = consumption[consumption.length - 1];
  const lastDate = new Date(last.date);
  const filled = [...consumption];
  while (filled.length < 3) {
    const newDate = new Date(lastDate);
    newDate.setFullYear(lastDate.getFullYear() - filled.length);
    filled.unshift({
      date: newDate.toISOString().slice(0, 10),
      quantity: last.quantity,
    });
  }
  return filled;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Suissetec ${url} failed HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}
