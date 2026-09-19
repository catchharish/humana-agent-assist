# STATUS

**Milestone:** M4 complete (reasoning loop, chain 10/10, no graph). T01 + six replays green.
**Last updated:** 19 Sep 2026

## Works
- Model-routed answers (Terra + session-bound tools). `queryRouter` gone. Quotes: code-on-yes uses the same `getQuotes` GET; model after consent.
- Plan filter and support check use the session plan. M004 $12 / DEMO-POLICY-OTHER kept; MAPD cost policy rejected for that session.
- Coverage list returns 200 `{ cases: [] }`. Chain hops c02/c07/c08 work.
- NBA action ids from playbook text. M005 “none” is model-reasoned (not a code stop). M002 enrolled / M003 DNC still code stops. Playbook-only `other_plan_cost_explain` for M004.
- Presenter member selector (M001–M005). Not-canned tests passed. Log kind `lookup_trace`.
- Chain `runs/chain_eval_1789835175024.json`: **10/10**, 0 over 8s. Graph: do not build now.
- GitHub `main` at `9859fab`: https://github.com/catchharish/humana-agent-assist
- T01 passed. Six replays passed.

## Broken / incomplete
- Vercel production deploy was started (`humana-agent-assist-e7vrtxvqj-…vercel.app`); confirm the alias after the build finishes. GitHub→Vercel repo link failed in the CLI (deploy still uploaded files).

## Next three tasks
1. Confirm the production URL loads with `OPENAI_API_KEY` set on Vercel.
2. Optional freeze / SUBMISSION.md pass if presenting.
3. Stop unless asked.

## Open questions for Harish
- None.
