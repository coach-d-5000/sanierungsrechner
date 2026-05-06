// Supabase Edge Function (Deno runtime). Reuses the same model code as the
// dev server. Deploy with `supabase functions deploy sanierung-estimate`.
//
// Routes (after the function path prefix):
//   POST /estimate              → EstimationResult for one scenario
//   POST /estimate-both         → { brine, air }
//   POST /suissetec/calculate   → suissetec JSON + PDF URL
//   POST /suissetec/pdf         → application/pdf stream

import { estimate } from "../_shared/model/estimate.ts";
import {
  calculateViaSuissetec,
  fetchPdfFromInput,
  isSupportedBySuissetec,
  type SuissetecCalculationInput,
} from "../_shared/model/suissetecProxy.ts";
import {
  searchAddresses,
  fetchBuildingByFeatureId,
  lookupAddress,
} from "../_shared/model/gwrLookup.ts";
import type { EstimationInput } from "../_shared/model/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/sanierung-estimate/, "") || "/";

  try {
    if (req.method === "GET" && path === "/health") {
      return jsonResponse({ ok: true });
    }
    if (req.method === "POST" && path === "/estimate") {
      const body = (await req.json()) as EstimationInput;
      return jsonResponse(estimate(body));
    }
    if (req.method === "POST" && path === "/estimate-both") {
      const body = (await req.json()) as EstimationInput;
      return jsonResponse({
        brine: estimate({ ...body, scenario: { source: "brine" } }),
        air: estimate({ ...body, scenario: { source: "air" } }),
      });
    }
    if (req.method === "GET" && path === "/gwr/search") {
      const q = url.searchParams.get("q");
      if (!q) return jsonResponse({ error: "Query parameter 'q' required" }, 400);
      return jsonResponse(await searchAddresses(q));
    }
    if (req.method === "GET" && path.startsWith("/gwr/feature/")) {
      const fid = decodeURIComponent(path.replace("/gwr/feature/", ""));
      return jsonResponse(await fetchBuildingByFeatureId(fid));
    }
    if (req.method === "GET" && path === "/gwr/lookup") {
      const q = url.searchParams.get("q");
      if (!q) return jsonResponse({ error: "Query parameter 'q' required" }, 400);
      return jsonResponse(await lookupAddress(q));
    }
    if (req.method === "POST" && path === "/suissetec/calculate") {
      const body = (await req.json()) as SuissetecCalculationInput;
      if (!isSupportedBySuissetec(body.fuelType)) {
        return jsonResponse({ error: `Brennstoff ${body.fuelType} wird nicht unterstützt.` }, 400);
      }
      return jsonResponse(await calculateViaSuissetec(body));
    }
    if (req.method === "POST" && path === "/suissetec/pdf") {
      const body = (await req.json()) as SuissetecCalculationInput;
      if (!isSupportedBySuissetec(body.fuelType)) {
        return jsonResponse({ error: `Brennstoff ${body.fuelType} wird nicht unterstützt.` }, 400);
      }
      const blob = await fetchPdfFromInput(body);
      return new Response(blob, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="sanierungsrechner.pdf"`,
        },
      });
    }
    return jsonResponse({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
