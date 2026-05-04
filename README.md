# Sanierungsrechner

Heat-pump replacement calculator for St. Gallen. Pre-step approximation + suissetec official PDF + GWR address lookup + Sonnendach roof scanner.

**Start here:** [`HANDOVER.md`](./HANDOVER.md) — full status, what's running, what's next, deploy steps.

For Claude Code users: [`CLAUDE.md`](./CLAUDE.md) gives project-specific context that Claude Code picks up automatically.

## Quick start

```bash
node --experimental-strip-types server/dev.ts
# open http://localhost:8787
```

That serves the sandbox UI (Leaflet map + GWR + Sonnendach) and the JSON API.
