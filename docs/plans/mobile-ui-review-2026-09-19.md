# Mobile UI improvements and fixes — 2026-09-19

Working branch: `codex/ui-improvements-and-bugfixes`, created from `main`
(`986dd79`). The previous local changes to the production plan and its
HTML presentation were kept intact when switching branches. This delivery
remains local, without commit or push.

## Changes made

- **Phone access:** pasting a number with `+` or `00` recognizes the international
  prefix and selects an enabled country. Duplicating the prefix is avoided,
  an unsupported country is kept as invalid and a number that is too long
  is not silently truncated. The initial country follows the server catalog.
- **Country selector:** touch areas of at least 48 points, adaptive text,
  accessible selected state and an error next to the field. The server still
  validates the numbering rules of each country.
- **OTP:** pasting six digits separated by spaces keeps the full code.
  The screen distinguishes a requested code, a sent one and a simulated one; it no longer
  announces a sending that has not happened yet.
- **Driver registration:** vehicle, services and data sections; plate/model errors
  next to their fields; scrollable confirmation and errors.
  Back and switching vehicle are disabled while saving. An immediate
  lock prevents repeated submissions before the visual state updates.
- **Service selection:** tapping the selected vehicle again no longer
  resets all its services. The data remains available for retrying
  after a registration failure.
- **Registration states:** loading with an exit, visible retry, full quota and
  an unavailable edit link. Registering the last vehicle type keeps
  its confirmation after the list refreshes.
- **Shared messages:** the compact mode of `FeedbackState` keeps the
  height its text needs, avoiding overlapping the next button when enlarging
  the typography. The expanded mode keeps its previous behavior.

## Verification

| Check | Result |
|---|---|
| `cd mobile && npm test` | **283 tests passing**, no failures or skips; includes 8 new phone-input regressions. |
| `cd mobile && ./node_modules/.bin/tsc --noEmit` | Passed. |
| `cd mobile && EXPO_NO_DOTENV=1 npm run lint` | Passed. |
| `git diff --check` | Passed. |
| Real components compiled with Metro for React Native Web | International phone, country selection, formatted OTP, repeated selection, saving, retry, editing and registration states passed. No JavaScript errors. |
| Geometry in Chromium | 32 combinations: access/registration/error/full quota × 320/390 px × light/dark × text 100/200 %. No horizontal overflow; messages without overlap; last action reachable by scrolling. |

The UI viewer replaced the network and navigation hooks with simulated data;
it used the real presentation components and phone controllers.
Text scaling was simulated in React Native Web. The screenshots were also
inspected, which made it possible to detect and fix the message overlap.

Local evidence, excluded from Git: `local-files/mobile-ui-review-2026-09-19/`
(screenshots, interaction results and test log). The viewer and its check
script were generated in `/tmp/viajaya-mobile-ui-review/`; they are neither a new
application nor a product dependency.

## Limits and pending closure

This check does not certify keyboard, TalkBack, autofill or native navigation
on an Android device. Walking through access and registration with the dev build,
large text, an open keyboard and a real connection is still missing. No new APK was built.
There were no changes to HTTP/WebSocket contracts, backend, secrets or services.

The **275 mobile tests** of the production readiness report remain
the evidence for the `main` base reviewed before these fixes;
the **283** correspond to this working branch. Phases F02 and F04 keep
their pending items and exit criteria from the [production plan](production-launch-plan.md).
