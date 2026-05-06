import { estimate } from "./estimate.ts";

const scenarios = [
  {
    label: "1965 EFH, 150 m², 4 Pers., Öl 2200 L/Jahr, Radiatoren — Sole",
    input: {
      building: {
        yearBuilt: 1965,
        heatedAreaM2: 150,
        occupants: 4,
        buildingType: "EFH" as const,
        distribution: "radiators" as const,
      },
      current: { fuelType: "heating_oil" as const, annualConsumption: 2200 },
      scenario: { source: "brine" as const },
    },
  },
  {
    label: "1965 EFH, 150 m², 4 Pers., Öl 2200 L/Jahr, Radiatoren — Luft",
    input: {
      building: {
        yearBuilt: 1965,
        heatedAreaM2: 150,
        occupants: 4,
        buildingType: "EFH" as const,
        distribution: "radiators" as const,
      },
      current: { fuelType: "heating_oil" as const, annualConsumption: 2200 },
      scenario: { source: "air" as const },
    },
  },
  {
    label: "1995 EFH, 180 m², 4 Pers., Gas 2200 m³/Jahr äquivalent (22'000 kWh), Bodenheizung — Luft",
    input: {
      building: {
        yearBuilt: 1995,
        heatedAreaM2: 180,
        occupants: 4,
        buildingType: "EFH" as const,
        distribution: "underfloor" as const,
      },
      current: { fuelType: "natural_gas" as const, annualConsumption: 22000 },
      scenario: { source: "air" as const },
    },
  },
  {
    label: "Nur Adresse + Kosten: 1985 EFH, 180 m², 4 Pers., 2900 CHF Öl-Kosten/Jahr, Radiatoren — Sole",
    input: {
      building: {
        yearBuilt: 1985,
        heatedAreaM2: 180,
        occupants: 4,
        buildingType: "EFH" as const,
        distribution: "radiators" as const,
      },
      current: { fuelType: "heating_oil" as const, annualCostChf: 2900 },
      scenario: { source: "brine" as const },
    },
  },
];

for (const s of scenarios) {
  console.log("\n=== " + s.label + " ===");
  const r = estimate(s.input);

  console.log(`Wärmebedarf: ${r.heatDemand.annualKwh} kWh/a (${r.heatDemand.method}, Konfidenz ${r.heatDemand.confidence})`);
  if (r.current) {
    console.log(`Heute: ${r.current.annualConsumption} ${r.current.consumptionUnit}/a · ${r.current.annualCostChf} CHF/a · ${r.current.co2KgPerYear} kg CO₂/a`);
  }
  console.log(`Empfehlung: ${r.heatPump.recommendedModelName}`);
  console.log(`  Spitzenlast ${r.heatPump.peakLoadKw} kW · JAZ ${r.heatPump.jaz} · Auslegung ${r.heatPump.oversizedFactor}×`);
  console.log(`  Strom: ${r.heatPump.electricityKwhPerYear} kWh/a → ${r.heatPump.annualCostChf} CHF/a → ${r.heatPump.co2KgPerYear} kg CO₂/a`);
  if (r.heatPump.borehole) {
    console.log(`  Erdsonde: ${r.heatPump.borehole.meters} m (Energie ${r.heatPump.borehole.metersByEnergyMethod} m | Leistung ${r.heatPump.borehole.metersByPowerMethod} m)`);
  }

  if (r.comparison) {
    const c = r.comparison;
    const inst = c.installation;
    const pb = c.payback;
    console.log(`\n  --- Wirtschaftlichkeit ---`);
    console.log(`  Investition (brutto)         ${fmt(inst.turnkeyChf)}`);
    console.log(`  − Förderung gesamt           ${fmt(-inst.subsidies.total)}`);
    for (const sub of inst.subsidies.components) {
      console.log(`      ${sub.name.padEnd(48)} ${fmt(-sub.chf)}`);
    }
    console.log(`  = Investition netto          ${fmt(inst.netCostChf)}`);
    console.log(`  − Steuerersparnis (18 %)     ${fmt(-pb.taxSavingChf)}   (auf ${fmt(pb.taxDeductibleChf)} abziehbar)`);
    console.log(`  = Effektive Kosten           ${fmt(pb.effectiveNetCostChf)}`);
    console.log(`  − Wertsteigerung (~1:1)      ${fmt(-pb.valueUpliftChf)}`);
    console.log(`  = Wirtschaftliche Position   ${fmt(pb.effectiveNetCostAfterValueUpliftChf)}`);
    console.log("");
    console.log(`  Jährliche Einsparung         ${fmt(c.annualSavingsChf)}/a   (${Math.round(c.annualSavingsPct * 100)} % gegenüber heute)`);
    console.log(`  CO₂ Einsparung               ${c.co2SavingsKgPerYear.toLocaleString()} kg/a`);
    console.log("");
    console.log(`  Amortisation`);
    console.log(`    direkt                     ${formatYears(pb.grossPaybackYears)}`);
    console.log(`    mit Steuerersparnis        ${formatYears(pb.withTaxPaybackYears)}`);
    console.log(`    mit Steuern + Wertsteig.   ${formatYears(pb.withTaxAndValueUpliftYears)}`);
  }

  if (r.caveats.length) {
    console.log(`\n  Hinweise:`);
    for (const c of r.caveats) console.log(`    · ${c}`);
  }
}

function fmt(chf: number): string {
  const sign = chf < 0 ? "−" : " ";
  return (sign + Math.abs(chf).toLocaleString("de-CH").replace(/,/g, "'") + " CHF").padStart(14);
}

function formatYears(y: number | null): string {
  if (y === null) return "nicht erreicht";
  if (y === 0) return "sofort (negative Effektivkosten)";
  return `${y.toFixed(1)} Jahre`;
}
