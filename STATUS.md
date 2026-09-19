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
- GitHub `main`: https://github.com/catchharish/humana-agent-assist (GitHub linked on Vercel).
- **Production:** https://humana-agent-assist.vercel.app — T01 Start + Resume verified 19 Sep: greeting Said, Harry MAPD after auth, refill answer (Lakeview / ready for pickup). OPENAI_* set. Run log + ready-answer cache write to `/tmp` on Vercel.

## Broken / incomplete
- None for production Start (EROFS fixed; logs/cache under `/tmp` on Vercel).

## Next three tasks
1. Optional freeze / SUBMISSION.md pass if presenting.
2. Confirm the GitHub-connected Vercel deploy of this commit stays green.
3. Stop unless asked.

## Open questions for Harish
- None.
