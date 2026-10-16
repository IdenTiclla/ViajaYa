# ViajaYa — Q4 2026 strategy and Linear backlog plan

Date: 2026-10-16. Author: CEO role (ceo-software-company skill), for the founder's review.
Period: **Q4 2026, 2026-10-19 → 2026-12-31** (about 11 weeks, five 2-week cycles).

**Nothing has been created in Linear.** This document is the proposal; Linear is filled in
phases (section 9) only after the founder approves each phase.

Sources: `README.md`, [production launch plan, revision 24](production-launch-plan.md),
[plan 0011](../implementation-plans/0011-territories-and-currency.md), git history of `main`
up to `e0ff729` (PR #26), and a read-only look at the Linear workspace on 2026-10-16.
Figures marked *(estimate)* are mine; everything else comes from those sources.

## 1. Executive summary

- The ride core works and is tested (746 backend / 454 mobile tests at revision 24, CI green),
  but **no launch phase after F01 is closed**. F02, F04, F05 and F06 are partial; F03, F07–F10 have not started.
- Since revision 24 (2026-09-24), the history shows ~25 commits (PRs #20–#26) of UI redesigns plus
  auto-accept and arrival time. None of them closes a phase exit criterion, and the plan's
  next delivery #1 (two-phone certification of `main`) is still open.
- **Q4 bet:** stop polishing, close phases. End the quarter with a certified candidate, territories,
  driver approval, a money ledger, and every launch decision taken. **Public launch is not a Q4 goal**;
  the target is a closed pilot in Q2 2027 *(estimate, one developer)*.
- Linear is empty (team `VIA`, default labels, four onboarding issues). The proposal is
  3 initiatives, 10 Q4 projects, ~20 milestones and ~55 issues, plus 5 backlog projects for 2027.

## 2. Diagnosis

| Area | Where we are (verified) | Gap that blocks a pilot |
|---|---|---|
| Ride core | Negotiation, atomic assignment, lifecycle, ratings, WS, outbox, Redis; auto-accept at the passenger's fare (migration `0031`) | Incidents, verified pickup, support |
| Access (F02) | Phone/simulated OTP, sessions, Google in Development | Visible recovery entry, real SMS adapter, provider choice |
| Territories (F03) | Fixed Bolivia outline in `domain/service_area.py`; plan 0011 written | Not implemented; plan's migration numbers `0029`/`0030` are now taken (head is `0032`) |
| Drivers (F04) | Registration, one vehicle per type, mode switching, auto-approve in dev | Documents, operator review, eligibility, suspension |
| Tracking/navigation (F05/F06) | GPS, Android Google Navigation, Waze implemented locally | Never certified on two real phones |
| Money (F07) | QR/cash is only a selection | No ledger, commission, collection or settlement |
| Parcels (F08), certification (F09), Play (F10) | `delivery` service type only | Everything |
| Business | — | 7 open decisions in section 6 of the launch plan (city, SMS, QR, budget, Play, Facebook, moving) |

**Capacity assumption:** one developer (the founder) working with AI agents, ~45 productive days in
the quarter *(estimate)*. If more people join, section 8 shows what moves forward first.

## 3. Vision, mission and values

**Vision (3–5 years):** be the way Bolivians, and then the region, agree a fair ride or delivery in
seconds, with drivers who earn more because the price is negotiated, not imposed.

**Mission:** connect passengers and senders with nearby taxi, moto and parcel drivers through a
transparent negotiation, safe rides and money that always adds up.

**Values (with the behaviour that shows them):**

1. **Fair price for both sides** — every pricing or commission change states its effect on passengers *and* drivers.
2. **Trust is evidence** — a phase is closed with a walkthrough, tests and a record, never "the code is merged".
3. **Safety before growth** — a zone opens only with approved drivers, support and reconciliation in place.
4. **Small and reversible** — features ship behind flags and can be switched off without breaking active rides.

## 4. Strategic bets for Q4 (max. 3)

1. **Certify what we already have.** The two-phone walkthrough is the cheapest way to find what really
   blocks users; until it happens, every new screen adds untested surface.
2. **Build the operating backbone (territories, panel, driver approval).** It is the dependency of
   F04–F10 and of any real zone opening. Supply (approved drivers) must exist before demand.
3. **Make money traceable before making it digital.** Ledger + cash + frozen commission first (F07-A),
   while the QR provider is chosen in parallel. QR integration waits for a sandbox contract.

## 5. Q4 2026 OKRs

**O1 — A release candidate a real person can use end to end.** *(Initiative I1)*

| KR | Baseline | Target 2026-12-31 |
|---|---|---|
| KR1.1 Current `main` certified on two Android phones: OTP, Google, number change, recovery, taxi and moto ride with GPS + Google Navigation, evidence recorded | Not done | Done, 0 open Urgent bugs |
| KR1.2 F03-A territories and currency merged, backfill tested on disposable PostgreSQL | 0 % | Merged, exit criterion of plan 0011 met |
| KR1.3 An operator approves or rejects a driver with documents from the panel; only approved, eligible drivers receive requests | Auto-approve only | Demonstrated in Development with tests |
| KR1.4 CI green on every merge to `main`; test counts do not decrease | 746 / 454 | ≥ 746 / ≥ 454, 100 % green merges |

**O2 — Every ride is accountable money.** *(Initiative I2)*

| KR | Baseline | Target |
|---|---|---|
| KR2.1 Ledger, frozen commission and cash flow merged (F07-A): 100 % of completed Development rides have balanced ledger entries | No ledger | 100 % in tests and walkthrough |
| KR2.2 QR gateway chosen, with sandbox access | No quotes | 1 provider with sandbox credentials |
| KR2.3 Commission %, settlement calendar, cancellation rule and cash debt limit decided and stored in configuration | Undefined | 4/4 decided |

**O3 — The non-code path to a pilot is clear.** *(Initiative I3)*

| KR | Baseline | Target |
|---|---|---|
| KR3.1 Launch-plan decisions closed (city/zone, SMS, QR, budget/hosting, Play account, Facebook, moving) | 0/7 | ≥ 6/7 |
| KR3.2 Written legal memo from local counsel (transport, moto, parcels, insurance, invoicing) | None | Received |
| KR3.3 Pilot supply: drivers in the pilot zone committed to a closed test *(target is an estimate)* | 0 | ≥ 20 drivers, ≥ 12 closed testers lined up |

## 6. Roadmap: Now / Next / Later

| Horizon | Phases | Outcome |
|---|---|---|
| **Now — Q4 2026** | Close F02, certify F05-B/F06 on phones, F03-A, F03-B/C base, F04-A/B, F07-A, all decisions | Certified candidate + backbone + ledger |
| **Next — Q1 2027** *(estimate)* | F04-C, F05-C, F07-B/C (QR, settlements, finance panel), F08 parcels, F09-A hosting | Complete service with QR and parcels on hosted infra |
| **Later — Q2 2027** *(estimate)* | F09-B/C certification, F10 Play closed test and first zone | Closed pilot in one city, then gradual opening |

## 7. What we will NOT do this quarter

- New UI redesigns that are not tied to a KR or to a bug found in certification.
- iOS, a second country, currency conversion.
- Truck/`moving` in the launch scope (confirm as decision D7).
- Facebook login (stays disabled; confirm as decision D6).
- Reactivating Testing; hosted production (that is F09, Q1 2027).
- QR integration code before a sandbox contract exists.

## 8. Linear structure

### 8.1 Mapping

| Concept | Linear object | Notes |
|---|---|---|
| Objective (O1–O3) | **Initiative** | The connected Linear MCP has no initiative tool: create the 3 initiatives by hand in the UI, or use project labels `okr-o1/o2/o3` as fallback |
| Launch phase sub-delivery | **Project** with lead, target date and description (problem, goal, scope, risks, metric, OKR link) | Name is an outcome, not an activity |
| Verifiable checkpoint | **Milestone** (2–3 per project) | |
| 1–5 days of work | **Issue** using the skill template (context, what, acceptance criteria, notes) | Split anything over 5 days into sub-issues |
| Vision + OKRs | **Linear document** "Vision and Q4 2026 OKRs" | Copy of sections 3–5 |
| Cadence | **Cycles** of 2 weeks, starting Monday 2026-10-19 | C1 Oct 19, C2 Nov 2, C3 Nov 16, C4 Nov 30, C5 Dec 14 |

**Labels.** Keep the existing `Bug`, `Feature`, `Improvement`. Add area labels `backend`, `mobile`,
`panel`, `infra`, `product`, `business`, `legal` and type labels `tech-debt`, `research`, `decision`, `qa`, `docs`.
**Priority:** Urgent = blocks users or money today; High = a Q4 KR depends on it; Medium = planned; Low = nice to have.
**Estimate:** days (1, 2, 3, 5).

### 8.2 Prioritization of Q4 projects (impact vs. effort)

Impact 1–5 against the KRs; effort in developer-days *(estimates)*.

| # | Project | KR | Impact | Effort | Q4 commitment |
|---|---|---|---:|---:|---|
| P1 | Two-phone certification of the current candidate | 1.1 | 5 | 7 + bugs | Commit |
| P2 | Access closed out (F02) | 1.1, 3.1 | 4 | 7 | Commit |
| P3 | Territories and currency (F03-A) | 1.2 | 4 | 10 | Commit |
| P4 | Admin panel and feature flags (F03-B/C) | 1.3 | 4 | 14 | Commit panel, roles, backend flags; rest may slide |
| P5 | Driver approval and eligibility (F04-A/B) | 1.3 | 5 | 12 | Commit documents, review, eligibility; rest may slide |
| P6 | Ledger and cash (F07-A) | 2.1 | 5 | 10 | Commit |
| P7 | QR gateway and commercial rules | 2.2, 2.3 | 4 | 2 dev + founder time | Commit |
| P8 | Pilot launch decisions | 3.1 | 5 | founder time | Commit |
| P9 | Legal and compliance groundwork | 3.2 | 4 | founder time + counsel | Commit |
| P10 | Driver supply for the pilot | 3.3 | 4 | founder time | Commit |

Developer total ≈ 62 days (before certification bugs) against ~45 available. The **slide list, in
order, is ≈ 12 days**: the assisted recovery tool (3), app capabilities and the flag-off test (3),
limiting pre-assignment data and pickup verification (4), and the wallet screens (2). That leaves a
committed core of ≈ 50 days, so certification bugs are paid for by sliding more of P4/P5, never P1, P3
or the P6 ledger. The trade-off is deliberate.

### 8.3 Project and issue tree (Q4)

Format: `Issue title — labels · priority · estimate`. All issues go to team `VIA`.

#### Initiative I1 — Release candidate end to end (O1)

**P1 · Two-phone certification of the current candidate** — lead: founder · target 2026-11-13 · F05-B/F06
- Milestone M1.1 QA script and identified build · M1.2 Walkthrough recorded · M1.3 Blocking bugs fixed
- Write the two-phone QA script (access, taxi, moto, GPS, navigation, Waze) — qa, docs · High · 1
- Build a Development APK from a tagged `main` commit and record it — mobile, qa · High · 1
- Walk through passenger and driver taxi + moto rides on two phones and record evidence — qa · High · 2
- Certify Google Navigation stages, voice, detours and the Waze fallback (F06-B/C) — mobile, qa · High · 1
- Verify tracking recovery: background, lost network, reconnection, stale GPS (F05-B) — mobile, qa · High · 1
- Triage and fix certification blockers (parent issue; one sub-issue per bug) — Bug · Urgent · TBD
- Update the launch plan to revision 25 (PRs #20–#26, auto-accept, certification result) — docs · Medium · 1

**P2 · Access closed out (F02)** — target 2026-11-27
- Milestone M2.1 Recovery visible in the app · M2.2 Real SMS adapter contract-tested
- Restore a visible entry to access recovery in the app — mobile · High · 2
- Decide the SMS provider for Bolivia (quote delivery and local rate) — business, decision · High · 1 *(also D2)*
- Implement the real SMS adapter with errors, limits and contract tests (production only) — backend · High · 3
- Decide what replaces the Testing-dependent F02 exit items — product, decision · Medium · 0.5
- Record the Facebook decision for the first launch — product, decision · Low · 0.5 *(D6)*

**P3 · Territories and currency (F03-A)** — target 2026-12-04 · per plan 0011
- Milestone M3.1 Domain and migrations · M3.2 API and mobile · M3.3 Evidence and backfill
- Renumber plan 0011 migrations after head `0032` — docs, backend · High · 0.5
- Add `Country`, `Zone`, `Money` and `TerritoryRepository` to the domain (A1) — backend · High · 2
- Create country/zone catalog and ride/offer currency migrations with `BOB` backfill (A2) — backend · High · 2
- Resolve zone on ride creation/edit and use the driver's time zone for earnings (A3) — backend · High · 2
- Expose `GET /api/v1/territory` and currency in ride/offer responses (A4) — backend · High · 1
- Add `features/territory` and per-currency formatting in mobile (A5) — mobile · High · 2
- Prove currencies never mix with a synthetic `XX` country and test the backfill on PostgreSQL (A6) — backend, qa · High · 1

**P4 · Admin panel and feature flags (F03-B/C)** — target 2026-12-18
- Milestone M4.1 Panel with reinforced access · M4.2 Roles and audit · M4.3 Flags live
- Decide the panel stack and where it runs in Development — product, decision · High · 0.5
- Create the panel skeleton with reinforced admin authentication — panel · High · 3
- Add admin/support/finance roles and an audit log of changes — backend, panel · High · 3
- Evaluate feature flags in the backend by country, zone and user group — backend · High · 2
- Consume capabilities in the app to show only enabled services and payments — mobile · Medium · 2 *(may slide)*
- Prove that turning a flag off blocks new operations but lets active rides finish — qa · Medium · 1 *(may slide)*
- Build the assisted access-recovery tool on the F02 contract — panel, backend · Medium · 3 *(may slide)*

**P5 · Driver approval and eligibility (F04-A/B)** — target 2026-12-31
- Milestone M5.1 Private documents · M5.2 Operator review · M5.3 Eligibility enforced
- Upload private driver documents (storage port + mobile form) — backend, mobile · High · 3
- Let an operator approve, reject, suspend and expire drivers from the panel — panel, backend · High · 3
- Send requests only to approved, available drivers enabled for that service and zone — backend · High · 2
- Limit personal data and exact locations exposed before assignment — backend · Medium · 2 *(may slide)*
- Show vehicle identification and verify pickup — mobile · Medium · 2 *(may slide)*

#### Initiative I2 — Every ride is accountable money (O2)

**P6 · Ledger and cash (F07-A)** — target 2026-12-18
- Milestone M6.1 Payment status and frozen commission · M6.2 Ledger · M6.3 Wallet screens
- Separate service status from payment status — backend · High · 2
- Freeze the fare and commission rule when an offer is accepted — backend · High · 1
- Record collections, commissions, refunds and adjustments in a double-entry ledger — backend · High · 3
- Record the driver's cash declaration and the commission owed — backend, mobile · High · 2
- Replace the empty wallet with real payment and balance screens — mobile · Medium · 2 *(may slide)*

**P7 · QR gateway and commercial rules** — target 2026-11-30
- Milestone M7.1 Gateway shortlist · M7.2 Sandbox access · M7.3 Rules in configuration
- Shortlist and quote Bolivian QR gateways (dynamic QR, webhooks, refunds, settlements) — business, research · High
- Get sandbox credentials from the chosen gateway — business · High
- Decide commission %, settlement calendar, cancellation rule and cash debt limit — business, decision · High *(D3)*
- Store those rules in commercial configuration — backend · Medium · 2

#### Initiative I3 — Path to pilot cleared (O3)

**P8 · Pilot launch decisions** — target 2026-11-30 · one `decision` issue per item, each closes with a written record in the launch plan
- D1 Choose the pilot city/zone, expected volume and support hours — business · High
- D2 Choose the SMS provider *(linked to P2)* — business · High
- D3 Choose the QR provider and commercial model *(linked to P7)* — business · High
- D4 Set the monthly budget cap and hosting region after a latency test from Bolivian mobile networks — business, infra · High
- D5 Open the Google Play account (type, owner) and check the 12 testers / 14 days rule — business · Medium
- D6 Confirm Facebook stays disabled *(linked to P2)* — product · Low
- D7 Confirm truck/`moving` stays out of the launch — product · Low

**P9 · Legal and compliance groundwork** — target 2026-12-18
- Hire local counsel and get a memo on transport, moto, parcels, insurance, driver contracts and invoicing — legal · High
- Draft terms, privacy policy and driver conditions (published in F09-C) — legal · Medium
- List data-deletion and retention requirements for Google Play (built in F09-C) — legal, research · Low

**P10 · Driver supply for the pilot** — target 2026-12-31
- Write the driver acquisition plan for the pilot zone (channels, message, incentive) — business · Medium
- Build an interest list and commit ≥ 20 drivers to a closed test — business · Medium
- Recruit ≥ 12 closed testers for Google Play — business · Medium
- Define the human support procedure and who answers — business · Medium

### 8.4 Backlog projects for 2027 (created empty, no issues yet)

| Project | Phase | Starts when |
|---|---|---|
| Live tracking and maps through the backend | F04-C, F05-C | P1 and P5 closed |
| QR payments, settlements and finance panel | F07-B/C | Sandbox from P7 |
| Complete parcels | F08 | P6 closed |
| Hosted production certification | F09 | D4 budget approved |
| Google Play and first zone | F10 | F09 closed |

## 9. Execution plan in Linear, by phase

Each phase ends with a short review; the next one starts only after the founder says yes.

**Phase 0 — Prepare the workspace** *(≈ 15 min)*
- Confirm team `VIA` is the only team; keep its default workflow statuses.
- Create the area and type labels from 8.1 (`save_issue_label`); keep `Bug`/`Feature`/`Improvement`.
- Enable 2-week cycles starting 2026-10-19 (Linear UI).
- Create the document "Vision and Q4 2026 OKRs" (`save_document`) with sections 3–5.
- Create the 3 initiatives in the UI (or project labels `okr-o1/o2/o3` via `save_project_label`).
- Ask the founder whether to archive onboarding issues VIA-1…VIA-4 (never without a yes).

**Phase 1 — Projects** *(10 Q4 projects)*
- `save_project` for P1–P10 with lead, target date, description template and initiative/label.
- Checkpoint: the founder reviews names, dates and leads.

**Phase 2 — Milestones**
- `save_milestone` for the ~20 milestones in 8.3, in project order.

**Phase 3 — Issues for Q4**
- `save_issue` in tree order (project → milestone → issue → sub-issue), template from the skill,
  with labels, priority and estimate. Before each project, search Linear for duplicates.
- Assign cycle 1 to P1, P2 (recovery), P3 (A1–A2), P7 and D1–D4; the rest stays in the backlog.

**Phase 4 — 2027 backlog and operating rhythm**
- Create the 5 empty projects from 8.4.
- Weekly: progress against KRs and the 3 priorities of the week (project updates in Linear).
- Every 2 weeks: cycle close and planning. Monthly: budget and decision review.
- Quarter end: OKR scoring, retro, Q1 2027 OKRs.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| One developer: the quarter does not fit | Explicit slide list in 8.2; certification and ledger protected |
| Two-phone walkthrough finds deep bugs | P1 first in cycle 1; its bug parent issue absorbs capacity before P4/P5 |
| Google Navigation beta breaks on a real phone | Certify in cycle 1; if it fails, decide before investing more (do not silently fall back to Waze) |
| No QR gateway gives a sandbox in Q4 | KR2.1 (ledger + cash) does not depend on it; QR moves to Q1 |
| Scope creep from redesigns | Rule in section 7; new UI work needs a KR or a certification bug |

## 11. Decisions needed from the founder

1. **Approve the Q4 goal**: certified candidate + backbone + ledger, with no public launch this quarter.
2. **Confirm the capacity assumption** (one developer); if not, say who joins.
3. **Approve Phase 0** of section 9 so labels, cycles, the vision document and initiatives can be created.
4. **Archive the onboarding issues VIA-1…VIA-4**: yes or no.
