---
description: Typecheck + test the project and report a concise pass/fail summary
allowed-tools: Bash(npm run typecheck), Bash(npm test), Bash(npm run build)
---

Run the project's verification gate and report results tersely.

1. `npm run typecheck`
2. `npm test`

If either fails, show only the relevant failing output (not the full log) and
the file:line to fix. If both pass, reply with a one-line green summary
(e.g. "✅ typecheck clean · N tests passed"). Do not make code changes unless
asked — this command only verifies.
