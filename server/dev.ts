import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { estimate } from "../supabase/functions/_shared/model/estimate.ts";
import {
  calculateViaSuissetec,
  fetchPdfFromInput,
  isSupportedBySuissetec,
  type SuissetecCalculationInput,
} from "../supabase/functions/_shared/model/suissetecProxy.ts";
import {
  searchAddresses,
  fetchBuildingByFeatureId,
  lookupAddress,
} from "../supabase/functions/_shared/model/gwrLookup.ts";
import type { EstimationInput } from "../supabase/functions/_shared/model/types.ts";

const PORT = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return end(res, 204);

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/sandbox" || url.pathname === "/sandbox/")) {
      const html = readFileSync(join(import.meta.dirname!, "..", "sandbox", "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/estimate") {
      const body = await readJson<EstimationInput>(req);
      return json(res, 200, estimate(body));
    }
    if (req.method === "POST" && url.pathname === "/estimate-both") {
      const body = await readJson<EstimationInput>(req);
      return json(res, 200, {
        brine: estimate({ ...body, scenario: { source: "brine" } }),
        air: estimate({ ...body, scenario: { source: "air" } }),
      });
    }
    if (req.method === "GET" && url.pathname === "/gwr/search") {
      const q = url.searchParams.get("q");
      if (!q) return json(res, 400, { error: "Query parameter 'q' required" });
      return json(res, 200, await searchAddresses(q));
    }
    if (req.method === "GET" && url.pathname.startsWith("/gwr/feature/")) {
      const fid = decodeURIComponent(url.pathname.replace("/gwr/feature/", ""));
      return json(res, 200, await fetchBuildingByFeatureId(fid));
    }
    if (req.method === "GET" && url.pathname === "/gwr/lookup") {
      const q = url.searchParams.get("q");
      if (!q) return json(res, 400, { error: "Query parameter 'q' required" });
      return json(res, 200, await lookupAddress(q));
    }
    if (req.method === "POST" && url.pathname === "/suissetec/calculate") {
      const body = await readJson<SuissetecCalculationInput>(req);
      if (!isSupportedBySuissetec(body.fuelType)) {
        return json(res, 400, { error: `Brennstoff ${body.fuelType} wird nicht unterstützt.` });
      }
      const result = await calculateViaSuissetec(body);
      return json(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/suissetec/pdf") {
      const body = await readJson<SuissetecCalculationInput>(req);
      if (!isSupportedBySuissetec(body.fuelType)) {
        return json(res, 400, { error: `Brennstoff ${body.fuelType} wird nicht unterstützt.` });
      }
      const blob = await fetchPdfFromInput(body);
      const buf = Buffer.from(await blob.arrayBuffer());
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": String(buf.length),
        "Content-Disposition": `inline; filename="sanierungsrechner.pdf"`,
      });
      return res.end(buf);
    }
    return json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: (err as Error).message });
  }
}).listen(PORT, () => {
  console.log(`Sanierungsrechner dev server listening on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  GET  /health");
  console.log("  POST /estimate");
  console.log("  POST /estimate-both");
  console.log("  GET  /gwr/search?q=<address>");
  console.log("  GET  /gwr/lookup?q=<address>  (search + first match prefill)");
  console.log("  GET  /gwr/feature/<EGID>_<EDID>");
  console.log("  POST /suissetec/calculate");
  console.log("  POST /suissetec/pdf");
});

function setCors(res: import("node:http").ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function end(res: import("node:http").ServerResponse, status: number) {
  res.writeHead(status);
  res.end();
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(text)),
  });
  res.end(text);
}

async function readJson<T>(req: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
