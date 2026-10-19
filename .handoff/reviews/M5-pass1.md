# M5 review pass 1 — public-mode security (workflow wf_910ce91f-dee: 3 lenses → 2 skeptics per finding, 35 agents)
16 findings, all upheld by at least one skeptic. Severities below are the skeptics' (they downgraded several).

| Row | Ids | Sev | Finding | Disposition |
|---|---|---|---|---|
| R1 | authz AUTH-1, static F1 | P1 | malformed request target (`//a:99999/`) throws in `new URL` before the try → unhandled rejection kills the process, no code needed (reproduced) | fix 06ed141: parse in try → 400; raw-socket test; mutation-checked |
| R2 | tests F1 | P2 | no test rejected a forged cookie (cookie test hit the then-open /api/version) | fix 42f64dd: cookie test on /api/config + forged cookie 401; mutation-checked |
| R3 | authz AUTH-2, static F2, tests F5 | P2/P3 | one shared code, no throttle, any length accepted | fix 06ed141: 10 wrong codes/min per client → 429; startup refuses public bind with a code < 12 chars; test |
| R4 | static F4 | P2 | local mode had no Host check (DNS rebinding to the unauthenticated localhost server) | fix 06ed141: local mode refuses non-localhost Host; test |
| R5 | static F3, authz AUTH-3, tests F4 | P2/P3 | public-mode WS accepted localhost origins; PUBLIC_ORIGIN with trailing slash silently failed; untested | fix 00beff8: public mode = only PUBLIC_ORIGIN (normalised); tests |
| R6 | static F5 | P3 | bad percent-encoding → 500 | fix 06ed141: 400 |
| R7 | tests F2 | P3 | traversal test could not fail (target file did not exist) | fix 06ed141: test with a real file outside dist + encoded variants |
| R8 | tests F3 | P3 | review diff predated the /api/version move | keep: covered by this pass and R2 |
| R9 | authz AUTH-4 | P3 | cookie is a fixed bearer token until the code rotates | file: rotate ACCESS_CODE to revoke (documented in the handoff) |
| R10 | static F6 | P3 | cached Basic credentials ride cross-site top-level requests | file: no CORS, so responses (client secrets) are unreadable cross-site; WS needs our origin |
| R11 | tests F6 | P3 | startup guard (public bind) has no test | file |

## M5 feature reviews (T008–T013), dispositions
| Task | Verdict | Fixed before merge | Filed |
|---|---|---|---|
| T008 header/terminal | pass | dev group hidden from first paint; summary dashes muted | 5 untested label strings |
| T009 Run demo | pass w/ concerns | Stop usable during demo (`demoing`); clip tools pin EN↔ES | runDemo has no direct test |
| T010 dashboard | pass | render tests (cell order, dashes, headline) | strict `<` vs PRD `≤` at exactly the target |
| T011 language pairs | pass | demo/eval/soak pin EN↔ES; STT hint only for zh; "a" in fr/pt words | live fr/pt/zh audio untested (no long runs, per human) |
| T012 architecture page | pass w/ fixes | barge-in, failure edges, contract error kinds, speech-end source, stat attribution | container diagram omits the SDP POST hop |
| T013 system demo | pass w/ fixes | "STT final" and "session start" no longer labelled measured | naive-mode hottest-component callout; 8 sim mutants survive; system-demo.ts untested |
| T005 streaming / T006 recovery | regression found | not merged (branches kept) | REQ-10 / REQ-13 stay partial, documented in COMPARISON.md |
