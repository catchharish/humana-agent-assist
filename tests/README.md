# tests/

Evaluator goldens and the replay driver live here. The running app must not import this directory (ESLint `no-restricted-imports` on `app/` and `lib/`).

```bash
# App must already be running for replay / HTTP checks
npm run dev
npm test
RUN_T01=1 npm run test:t01   # one automated main-call run; the other T01 is interactive
```

- `c01_disclosure.test.ts` — exactness, stitch, speaker, stage-1 trigger, no attestation tool
- `c02_authority.test.ts` / `c02_http.test.ts` — token 403, scope mismatch, pending transfer
- `c03_access.test.ts` — no member before auth; retrieved text cannot mint/submit
- `c05_claims.test.ts` + `goldens/c05_samples.json` — amount/entity and rejected false claims
- `c06_checklist.md` — manual UI
- `replays.test.ts` — T02A, T03A, T03B, T04B, T06A, T08B against localhost
- `t01_main.test.ts` — gated by `RUN_T01=1`
