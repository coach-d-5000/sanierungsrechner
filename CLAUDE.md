# Sanierungsrechner — Project Notes for Claude Code

This is a heat-pump replacement calculator for St. Gallen. Read `HANDOVER.md` first — it's the canonical "what is this and what's next" document. Everything below is for Claude Code's working context.

## Source of truth

- **`HANDOVER.md`** — full status, decisions to make, file map, deploy steps. Read this before doing anything substantive.
- **`data/`** — JSON config (heat pumps, fuel prices, subsidies, codes). Version-controlled, edited deliberately.
- **`model/`** — pure TypeScript, no framework. The actual calculation logic.
- **`server/dev.ts`** — Node HTTP server for local dev. Also serves `sandbox/index.html` at `/`.
- **`sandbox/index.html`** — standalone Leaflet UI for in-person sales testing.
- **`supabase/functions/sanierung-estimate/index.ts`** — Deno edge function, deploy target.
- **`e2e/run.ts`** — live test against suissetec API, parity table.

## Conventions

- All Swiss-German user-facing text. Code comments mostly German for domain terms, English where it's pure plumbing.
- Numbers display: CHF with apostrophe thousand-separator (`1'200 CHF`), tabular figures.
- No new npm dependencies without a clear reason. Stack is intentionally minimal: Node + TypeScript stripping, no bundlers.
- Use `Read`/`Edit` for all file changes. Don't `cat`/`sed`.

## Common commands

```bash
# Smoke test (no network)
node --experimental-strip-types model/smoketest.ts

# Live e2e against suissetec
node --experimental-strip-types e2e/run.ts

# Dev server + sandbox UI on localhost:8787
node --experimental-strip-types server/dev.ts

# If port stuck on EADDRINUSE
lsof -ti :8787 | xargs kill -9
```

## Working with the sandbox UI

The sandbox at `localhost:8787` is the in-person sales tool. After any edit to `sandbox/index.html`, just reload the browser tab — `server/dev.ts` re-reads the file on each request, no restart needed.

**Critical gotcha** when working with geo.admin identify calls: always include `sr=2056` when sending LV95 coordinates. Without it, the API silently returns zero features (it interprets the coords as Web Mercator). Cost a few hours to track down once.

## Three pending decisions (see HANDOVER.md for context)

1. **Where in git?** New repo / 100in100 monorepo / Lovable repo
2. **Edge Function deploy structure?** Bundle script vs `_shared` restructure
3. **Go-live timing?** When to swap Lovable's mock for the real backend

These are blocking. Bring them up if Dominik or his coworker hasn't decided yet.
