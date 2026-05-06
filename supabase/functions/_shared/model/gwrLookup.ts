import gwrCodes from "../data/gwr_codes.json" with { type: "json" };
import type { BuildingCategory, FuelType, EstimationInput } from "./types.ts";

const SEARCH_URL = "https://api3.geo.admin.ch/rest/services/api/SearchServer";
const FEATURE_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/ch.bfs.gebaeude_wohnungs_register";

export interface GwrAddressMatch {
  egid: string;
  featureId: string;
  label: string;
  lv03: { east: number; north: number };
  lv95: { east: number; north: number };
}

export interface GwrBuilding {
  egid: string;
  address: string;
  city: string;
  zip: string;
  buildingName: string | null;
  yearBuilt: number | null;
  buildingPeriodCode: number | null;
  buildingCategoryCode: number | null;
  buildingCategory: string | null;
  buildingClassCode: number | null;
  buildingClass: string | null;
  floors: number | null;
  dwellings: number | null;
  groundFloorAreaM2: number | null;
  energyReferenceAreaM2: number | null;
  volumeM3: number | null;
  heating: HeatingInfo;
  warmWater: WarmWaterInfo;
  coords: { east: number; north: number };
  rawAttributes: Record<string, unknown>;
}

export interface HeatingInfo {
  primary: { generatorCode: number | null; generatorLabel: string | null;
             sourceCode: number | null; sourceLabel: string | null;
             updatedAt: string | null; sourceCertaintyLabel: string | null };
  secondary: { generatorCode: number | null; generatorLabel: string | null;
               sourceCode: number | null; sourceLabel: string | null };
  isAlreadyHeatPump: boolean;
  isDistrictHeating: boolean;
  fossilFuel: FuelType | null;
}

export interface WarmWaterInfo {
  primary: { generatorCode: number | null; generatorLabel: string | null;
             sourceCode: number | null; sourceLabel: string | null };
  secondary: { generatorCode: number | null; generatorLabel: string | null;
               sourceCode: number | null; sourceLabel: string | null };
}

export async function searchAddresses(query: string): Promise<GwrAddressMatch[]> {
  const url = `${SEARCH_URL}?searchText=${encodeURIComponent(query)}&type=locations&origins=address&limit=8&lang=de`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const data = (await res.json()) as { results?: { attrs: Record<string, unknown> }[] };
  const out: GwrAddressMatch[] = [];
  for (const r of data.results ?? []) {
    const a = r.attrs;
    const featureId = String(a.featureId ?? "");
    if (!featureId) continue;
    const egid = featureId.split("_")[0];
    const labelHtml = String(a.label ?? "");
    out.push({
      egid,
      featureId,
      label: labelHtml.replace(/<\/?[^>]+>/g, ""),
      lv03: { east: Number(a.y), north: Number(a.x) },
      lv95: { east: Number(a.y) + 2000000, north: Number(a.x) + 1000000 },
    });
  }
  return out;
}

export async function fetchBuildingByFeatureId(featureId: string): Promise<GwrBuilding> {
  const res = await fetch(`${FEATURE_URL}/${featureId}?lang=de`);
  if (!res.ok) throw new Error(`GWR feature ${featureId} HTTP ${res.status}`);
  const data = (await res.json()) as { feature?: { attributes?: Record<string, unknown> } };
  const attrs = data.feature?.attributes ?? {};
  return mapBuilding(attrs);
}

export async function lookupAddress(query: string): Promise<{
  matches: GwrAddressMatch[];
  building: GwrBuilding | null;
  prefill: Partial<EstimationInput> | null;
  warnings: string[];
  isResidential: boolean;
}> {
  const matches = await searchAddresses(query);
  if (matches.length === 0) {
    return { matches, building: null, prefill: null, warnings: [], isResidential: false };
  }
  const building = await fetchBuildingByFeatureId(matches[0].featureId);
  const { prefill, warnings, isResidential } = buildingToPrefill(building);
  return { matches, building, prefill, warnings, isResidential };
}

export interface PrefillResult {
  prefill: Partial<EstimationInput>;
  warnings: string[];
  isResidential: boolean;
}

export function buildingToEstimationInput(b: GwrBuilding): Partial<EstimationInput> {
  return buildingToPrefill(b).prefill;
}

export function buildingToPrefill(b: GwrBuilding): PrefillResult {
  const warnings: string[] = [];

  const buildingType = inferBuildingType(b);
  const isResidential = buildingType !== null;
  if (!isResidential) {
    warnings.push(
      `Gebäude wird im GWR als "${b.buildingClass ?? b.buildingCategory ?? "nicht-Wohnnutzung"}" geführt. ` +
      `Der Sanierungsrechner ist auf Wohngebäude (EFH/MFH) ausgelegt — Resultate dienen nur als grobe Indikation.`,
    );
  }

  const heatedArea = b.energyReferenceAreaM2
    ?? (b.groundFloorAreaM2 != null && b.floors != null
        ? Math.round(b.groundFloorAreaM2 * Math.max(1, b.floors) * 0.85)
        : undefined);
  if (b.energyReferenceAreaM2 == null && heatedArea != null) {
    warnings.push(
      `Energiebezugsfläche im GWR nicht erfasst. Schätzung aus Grundfläche × Stockwerke × 0.85 = ${heatedArea} m². ` +
      `Bitte beim Kunden verifizieren.`,
    );
  }

  if (b.heating.isAlreadyHeatPump) {
    warnings.push("Gebäude wird laut GWR bereits mit einer Wärmepumpe betrieben — Ersatz prüft sich anders.");
  }
  if (b.heating.isDistrictHeating) {
    warnings.push(
      "Gebäude ist laut GWR an Fernwärme angeschlossen. Kein fossiler Ersatz nötig; " +
      "ein WP-Wechsel lohnt sich nur, wenn der Fernwärme-Tarif ungünstig ist.",
    );
  }

  const prefill: Partial<EstimationInput> = {
    building: {
      yearBuilt: b.yearBuilt ?? 1980,
      heatedAreaM2: heatedArea ?? 150,
      buildingType: buildingType ?? "EFH",
    },
    current: b.heating.fossilFuel ? { fuelType: b.heating.fossilFuel } : undefined,
  };

  return { prefill, warnings, isResidential };
}

function inferBuildingType(b: GwrBuilding): BuildingCategory | null {
  const klas = b.buildingClassCode;
  if (klas === 1110) return "EFH";
  if (klas === 1121) return "Reihenhaus";
  if (klas === 1122) return "MFH";
  if (klas != null && klas >= 1200) return null; // commercial / industrial / etc.
  // Fallback when gklas missing
  if (b.dwellings != null && b.dwellings >= 2) return "MFH";
  if (b.dwellings === 1) return "EFH";
  return null;
}

function mapBuilding(a: Record<string, unknown>): GwrBuilding {
  const num = (k: string) => (a[k] != null ? Number(a[k]) : null);
  const str = (k: string) => (a[k] != null ? String(a[k]) : null);
  const code = (k: string) => num(k);
  const label = (lookup: Record<string, string>, k: string) => {
    const v = a[k];
    return v != null ? (lookup[String(v)] ?? null) : null;
  };

  const gwaerzh1 = code("gwaerzh1");
  const genh1 = code("genh1");
  const isHeatPump = gwaerzh1 === 7410 || gwaerzh1 === 7411
    || genh1 === 7501 || genh1 === 7510 || genh1 === 7511 || genh1 === 7512 || genh1 === 7513;
  const isDistrictHeating = gwaerzh1 === 7460 || gwaerzh1 === 7461
    || genh1 === 7580 || genh1 === 7581 || genh1 === 7582;
  const fossilFuel = sourceToFuelType(genh1);

  return {
    egid: str("egid") ?? "",
    address: str("strname_deinr") ?? "",
    city: str("ggdename") ?? "",
    zip: (str("plz_plz6") ?? "").split("/")[0] ?? "",
    buildingName: str("gbez"),
    yearBuilt: num("gbauj"),
    buildingPeriodCode: num("gbaup"),
    buildingCategoryCode: num("gkat"),
    buildingCategory: label(gwrCodes.gkat, "gkat"),
    buildingClassCode: num("gklas"),
    buildingClass: label(gwrCodes.gklas, "gklas"),
    floors: num("gastw"),
    dwellings: num("ganzwhg"),
    groundFloorAreaM2: num("garea"),
    energyReferenceAreaM2: num("gebf"),
    volumeM3: num("gvol"),
    heating: {
      primary: {
        generatorCode: gwaerzh1, generatorLabel: label(gwrCodes.gwaerzh, "gwaerzh1"),
        sourceCode: genh1, sourceLabel: label(gwrCodes.genh, "genh1"),
        updatedAt: str("gwaerdath1"),
        sourceCertaintyLabel: label(gwrCodes.gwaersceh, "gwaersceh1"),
      },
      secondary: {
        generatorCode: code("gwaerzh2"), generatorLabel: label(gwrCodes.gwaerzh, "gwaerzh2"),
        sourceCode: code("genh2"), sourceLabel: label(gwrCodes.genh, "genh2"),
      },
      isAlreadyHeatPump: isHeatPump,
      isDistrictHeating,
      fossilFuel,
    },
    warmWater: {
      primary: {
        generatorCode: code("gwaerzw1"), generatorLabel: label(gwrCodes.gwaerzh, "gwaerzw1"),
        sourceCode: code("genw1"), sourceLabel: label(gwrCodes.genh, "genw1"),
      },
      secondary: {
        generatorCode: code("gwaerzw2"), generatorLabel: label(gwrCodes.gwaerzh, "gwaerzw2"),
        sourceCode: code("genw2"), sourceLabel: label(gwrCodes.genh, "genw2"),
      },
    },
    coords: { east: num("gkode") ?? 0, north: num("gkodn") ?? 0 },
    rawAttributes: a,
  };
}

function sourceToFuelType(genh: number | null): FuelType | null {
  switch (genh) {
    case 7530: return "heating_oil";
    case 7520: return "natural_gas";
    case 7542: return "wood_pellets";
    case 7541: return "wood_logs";
    case 7543: return "wood_chips";
    case 7560: return "electricity";
    case 7580: case 7581: case 7582: return "district_heating";
    default: return null;
  }
}
