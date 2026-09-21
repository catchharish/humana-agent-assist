# System architecture — Humana Agent Assist (full picture)

One Next.js app. Four layers work together:

1. **Talk input** — a timed transcript player (and optional presenter typing) simulates the phone call
2. **Session brain** — interprets speech, answers questions, proposes next actions, enforces rules
3. **Simulated Humana systems** — HTTP APIs that only read from fixture JSON files
4. **Advocate screen** — five regions updated live over SSE

Nothing in `app/` or `lib/` imports fixture files for answers. Fixtures are loaded **only** inside `/api/simulated/`* handlers.

---

## 1. Entire system at a glance

```mermaid
flowchart TB
  subgraph INPUT["① TALK INPUT — simulated phone / ASR"]
    Streams["fixtures/streams/*.json<br/>timed events: speech, IVR, auth, pauses"]
    TelAPI["GET /api/simulated/telephony/scenario-events"]
    Player["Browser stream player<br/>app/page.tsx<br/>waits by offsetMs · pause gates · streamHold"]
    Typed["Presenter typed / picked lines<br/>same ingest path"]
    Streams --> TelAPI --> Player
    Typed --> Player
  end

  subgraph UI["② ADVOCATE DESKTOP"]
    Strip["Call strip"]
    Rail["Obligations"]
    Now["Now card"]
    Ctx["Context / NBA / quotes"]
    Tr["Transcript"]
    SSE["SSE: GET /api/session/events"]
  end

  subgraph BRAIN["③ SESSION BRAIN"]
    Ingest["POST /api/session/ingest"]
    Sess["In-memory SessionState"]
    Copilot["Copilot orchestrator"]
    Luna["Luna — interpret + triggers"]
    Exact["Code — exact disclosures / nudges"]
    Terra["Terra answer loop + tools"]
    NBA["NBA engine<br/>playbooks → hard stops → one card"]
    Wrap["Wrap / handoff / disposition"]
    Log["runs/*.jsonl"]
  end

  subgraph SIM["④ SIMULATED SYSTEMS — HTTP only"]
    Elig["eligibility"]
    Ben["benefits"]
    Clm["claims"]
    Rx["pharmacy"]
    Prov["provider"]
    Scr["scripting"]
    Tel["telephony"]
    Cvr["coverage-review"]
  end

  subgraph DATA["⑤ DATA FILES — fixtures/*.json"]
    F1["members · authorizations · contact_preferences"]
    F2["plans · classifications · policies"]
    F3["purchases · prescriptions · refill · quotes · pharmacies"]
    F4["disclosures · knowledge · articles · utterance_rules"]
    F5["coverage · streams · presenter_questions"]
  end

  Player -->|"timed events"| Ingest
  Ingest --> Copilot --> Sess
  Copilot --> Luna
  Copilot --> Exact
  Copilot --> Terra
  Copilot --> NBA
  Copilot --> Wrap
  Terra --> SIM
  NBA --> Scr
  Copilot --> Tel
  Copilot --> Elig
  DATA --> SIM
  Sess --> SSE --> UI
  Copilot --> Log
  UI -->|"human clicks"| Copilot
```



---



## 2. How the transcript stream works

This is **not** a live phone. The browser plays a scripted timeline that stands in for telephony + ASR.

```mermaid
sequenceDiagram
  participant Adv as Presenter (Start)
  participant UI as page.tsx player
  participant Tel as telephony/scenario-events
  participant Fix as fixtures/streams/{id}.json
  participant Ing as /api/session/ingest
  participant Brain as Copilot + session
  participant Scr as Advocate screen

  Adv->>UI: Start scenario (T01 / Open call / replay)
  UI->>UI: POST /api/session/start
  UI->>Tel: GET ?id=t01_m2a
  Tel->>Fix: readFixture(streams/…)
  Tel-->>UI: { events: [ {offsetMs, type, …} ] }

  loop each event in time order
    UI->>UI: wait (offsetMs gap × playback stretch)
    alt pause_gate
      UI->>UI: freeze until Resume
    else transcript / system
      opt streamHold (lookup owns Now)
        UI->>UI: wait until answer paints / timeout
      end
      UI->>Ing: POST event
      Ing->>Brain: process (Luna / Terra / exactness)
      Brain-->>Scr: SSE publicState
    end
  end
```





### What a stream event carries


| `type`                     | Example                                                                 | What the brain does                      |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `transcript`               | Member/advocate words + `stability` (partial/final/corrected/uncertain) | Interpret, triggers, maybe answer loop   |
| `system` + `ivr_hint`      | Call reason from phone menu                                             | Fetch telephony IVR hint → session       |
| `system` + `authorization` | Simulated identity check                                                | POST eligibility auth → load member      |
| `pause_gate`               | “Advocate should react here”                                            | Player pauses; not counted as AI latency |


**Also feeds the same pipe:** presenter “Caller says…” / “You say…” / End call — same `ingest`, not a second brain.

**Files:** `fixtures/streams/open_call.json`, `t01_m2a.json`, `t02a`…`t08b.json`.

---



## 3. Fixture files → fake data subsystems

Each JSON file is a stand-in database. Only simulated route handlers open them.

```mermaid
flowchart LR
  subgraph FIX["fixtures/ — on disk"]
    members["members.json"]
    auth["authorizations.json"]
    prefs["contact_preferences.json"]
    plans["plans.json"]
    classif["classifications.json"]
    policies["policies.json"]
    purchases["purchases.json"]
    rx["prescriptions.json"]
    refill["refill.json"]
    quotes["quotes.json"]
    pharm["pharmacies.json"]
    disc["disclosures.json"]
    know["knowledge.json"]
    arts["articles.json"]
    rules["utterance_rules.json"]
    cov["coverage.json"]
    streams["streams/*.json"]
    pq["presenter_questions.json"]
  end

  subgraph API["/api/simulated/…"]
    E["eligibility"]
    B["benefits"]
    C["claims"]
    P["pharmacy"]
    V["provider"]
    S["scripting"]
    T["telephony"]
    R["coverage-review"]
  end

  members --> E
  auth --> E
  prefs --> E
  plans --> B
  classif --> B
  policies --> B
  purchases --> C
  rx --> P
  refill --> P
  quotes --> P
  pharm --> V
  disc --> S
  know --> S
  arts --> S
  rules --> S
  cov --> R
  streams --> T
  pq --> S
```





### Mapping table (what each file mimics)


| Fixture file               | Mimics                                       | Served by        | Typical fields / rows                          |
| -------------------------- | -------------------------------------------- | ---------------- | ---------------------------------------------- |
| `members.json`             | Member master                                | eligibility      | memberId, name, planId, LOB                    |
| `authorizations.json`      | ID&V / auth                                  | eligibility      | authorizationId, decision VALID, scopes        |
| `contact_preferences.json` | Contact / mail flags                         | eligibility      | doNotContact, mailServiceEnrolled              |
| `plans.json`               | Plan catalog                                 | benefits         | planId, plan facts                             |
| `classifications.json`     | Pharmacy network as-of date                  | benefits         | preferred vs standard by date                  |
| `policies.json`            | Cost-share / policy                          | benefits         | plan cost rules                                |
| `purchases.json`           | Pharmacy claims                              | claims           | $8 / $27 fills, dates, pharmacy                |
| `prescriptions.json`       | Active Rx                                    | pharmacy         | drug, strength, quantity                       |
| `refill.json`              | Refill request + status                      | pharmacy         | READY_FOR_PICKUP etc. (**always fetch fresh**) |
| `quotes.json`              | Prospective price quotes                     | pharmacy         | estimatedMemberCost (locked until consent)     |
| `pharmacies.json`          | Pharmacy directory                           | provider         | Lakeview, Oak Street, CenterWell names         |
| `disclosures.json`         | Required legal wording                       | scripting        | verbatimText (byte-for-byte)                   |
| `knowledge.json`           | Policies + **NBA playbooks** + search corpus | scripting SEARCH | policy / article / playbook chunks             |
| `articles.json`            | Service / FAST90 / objection copy            | scripting        | article bodies                                 |
| `utterance_rules.json`     | Consent / quote cue patterns                 | scripting        | loaded at session start                        |
| `coverage.json`            | Coverage-review cases                        | coverage-review  | pending case, no determination write           |
| `streams/*.json`           | Call timeline (ASR stand-in)                 | telephony        | offsetMs events                                |
| `presenter_questions.json` | Demo “Try a question” list                   | scripting        | topic + question text                          |


Every HTTP reply looks like:

```text
{ simulated: true, sourceSystem: "pharmacy", asOf: ISO-time, data: { … } }
```

Overlays for replays (T04B / T06A / …) can change what a handler returns via `X-Demo-Overlay` without changing the player.

---



## 4. Session brain — what happens to each utterance

```mermaid
flowchart TB
  Ev["Ingested event"]
  Ev --> Auth{"system: authorization?"}
  Auth -->|yes| EligAPI["eligibility auth + member GET"]
  EligAPI --> Prefetch["Prefetch stable member snapshot<br/>claims, network, prefs, Rx…"]
  Auth -->|no| Kind{"transcript?"}

  Kind -->|advocate| Exact["Exactness vs registry<br/>greeting / pricing / closing"]
  Exact --> Trig["Triggers: code stage 1 → Luna stage 2"]
  Trig --> Nudge["Obligation rail + optional nudge"]

  Kind -->|member| Luna["Luna interpret<br/>need / focus / consent hints"]
  Luna --> Consent["Code: comparison / enrollment consent"]
  Luna --> Q{"Member question?"}
  Q -->|yes| Loop["Terra tool loop"]
  Loop --> Tools["Session-bound tools → simulated REST"]
  Tools --> Ans["NeedAnswer → Now or parked"]
  Ans --> NbaKick["NBA after answer"]

  Consent -->|absolute_yes comparison| Quotes["Code fetches getQuotes"]
  Quotes --> NowQ["Quote amounts may appear"]
```



---



## 5. Next-best-action (NBA) system

NBA is **not** a separate microservice. It is a dedicated path inside the brain after (or alongside) answers.

```mermaid
flowchart TB
  Trigger["Kickoff: after a useful answer<br/>or explicit proposeNba"]
  Stop{"Code hard stops<br/>7 gates"}
  Stop -->|blocked| LogStop["Log hard_stop · no card"]
  Stop -->|clear| Search["SEARCH knowledge.json<br/>kind = playbook"]
  Search --> TerraNba["Terra picks at most ONE action<br/>from playbook text"]
  TerraNba --> Fact{"Facts in draft<br/>confirmed in session?"}
  Fact -->|no| Unconf["hard_stop: unconfirmed_fact"]
  Fact -->|yes| Seat["seatRecommendation<br/>→ session.recommendation"]
  Seat --> UI["Context: Offer / Dismiss<br/>or Confirm transfer"]
  UI --> Human["Advocate decides"]
  Human -->|Offer| EnrollPath["Enrollment readback path<br/>(human Confirm + token)"]
  Human -->|Confirm transfer| TelX["telephony transfers POST"]
  Human -->|Dismiss| Suppress["nbaDismissedThisCall"]
```





### Hard stops (code — model cannot override)


| Stop                  | Meaning                                     |
| --------------------- | ------------------------------------------- |
| `unverified`          | No VALID identity yet                       |
| `due_now`             | Required pricing/closing wording owns Now   |
| `already_enrolled`    | Mail service already on                     |
| `said_no`             | Member refused this call                    |
| `do_not_contact`      | Preference flag                             |
| `dismissed_this_call` | Advocate dismissed once                     |
| `unconfirmed_fact`    | Draft cites a fact not confirmed in session |




### What NBA reads

- **Playbooks** from `knowledge.json` (via scripting SEARCH) — action id, pill name, advocate control  
- **Session facts** — claims, network, contact prefs, coverage case, conversation  
- **Never tools:** enroll, decide coverage, take payment, clinical advice

Advocate **Offer / Dismiss / Confirm transfer** are human API routes; AI only drafts the card.

---



## 6. Answer path — data flowing through tools

```mermaid
flowchart LR
  Q["Member question text"]
  T["Terra"]
  Q --> T

  T -->|getClaims| C["claims ← purchases.json"]
  T -->|getPharmacyNetwork| N["benefits ← classifications.json"]
  T -->|getCostShare| P["benefits ← policies.json"]
  T -->|getPrescriptions / getRefillStatus| R["pharmacy ← prescriptions / refill"]
  T -->|getQuotes| Qot["pharmacy ← quotes.json<br/>only after consent"]
  T -->|searchKnowledge / lookupReadyAnswer| K["scripting ← knowledge / articles"]
  T -->|getCoverageCase| CV["coverage-review ← coverage.json"]
  T -->|getPharmacy| Pr["provider ← pharmacies.json"]
  T -->|getContactPreferences| Pref["eligibility ← contact_preferences"]

  C --> Out["Cited answer + source labels"]
  N --> Out
  P --> Out
  R --> Out
  Qot --> Out
  K --> Out
  CV --> Out
  Pr --> Out
  Pref --> Out
  Out --> Now["Now card / parked need"]
```



**Binding rule:** tools use the **session’s** `memberId` / `planId`. The model cannot pass another member’s id.

---



## 7. What the screen shows vs where it came from


| Screen region   | Main data source                                            |
| --------------- | ----------------------------------------------------------- |
| Call strip      | Session identity + IVR (after auth)                         |
| Obligation rail | Disclosure registry + exactness state                       |
| Now card        | Required wording **or** Terra answer **or** system message  |
| Context drawer  | Needs list, quotes, NBA recommendation, evidence            |
| Transcript      | Stream + presenter lines (stability marked)                 |
| Presenter bar   | Scenario picker → stream file; member picker → members.json |


Live updates: **SessionState →** `publicState` **→ SSE → React**.

---



## 8. Persistence / side stores


| Store                                | Role                                  |
| ------------------------------------ | ------------------------------------- |
| In-memory `Map` of sessions          | Live call state                       |
| `runs/<sessionId>.jsonl`             | Audit: tools, NBA, triggers, timings  |
| Ready-answer disk cache (gitignored) | Generated general FAQs from docs      |
| `fixtures/`                          | Only database the simulated APIs have |


---



## 9. One full call — data moving left to right

```text
streams/t01_m2a.json
        │  (offsetMs events)
        ▼
 Browser player ──ingest──► Copilot
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
           Luna            Exactness         Terra tools
        (need/consent)   (registry text)   (HTTP → fixtures)
              │               │                │
              └───────────────┴────────────────┘
                              │
                              ▼
                     SessionState update
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
            SSE             NBA              JSONL log
              │          (playbooks +
              ▼           hard stops)
         Advocate UI  ←── recommendation card
                              │
                         human Offer/Confirm
                              │
                              ▼
                    enroll token / transfer / disposition
```

That is the whole system: **scripted talk → brain → fixture-backed fake Humana APIs → live desktop**, with **NBA** as a first-class, code-gated suggestion path—not a separate product silo.