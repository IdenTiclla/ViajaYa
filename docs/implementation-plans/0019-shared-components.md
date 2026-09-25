# Shared components and ride cards

2026-09-19 · Implemented and verified locally · `codex/ui-improvements-and-bugfixes`.

Polish the visual base used by taxi/mototaxi: buttons, fields, dialogs,
loading/error states and person/offer cards. Reuse the brand and the
tokens, keep 48 touch targets, visible focus, dark theme and large text.

Apply the components on real screens and check the interactions before
closing: submission locking, disabled states, comment editing,
confirmation/cancellation and concurrent negotiations. Do not change contracts or
business rules. Document what was verified with adapters and what remains native.

## Delivery

- `Button`: 16 radius, highlighted main action, alternative with a readable
  border, press feedback and differentiated disabled/loading states.
  The 48 touch minimum, text growth and visible focus are kept.
- `TextField`: persistent labels, help below the field, error with priority
  over help, optional counter and native limit. Focus does not change the size.
  The togglable password is kept and the non-editable field is distinguished.
- `ConfirmDialog`: bottom card on mobile and centered on wide screens.
  The content can scroll; confirm and back stay in the footer.
  They respect the safe area, large text and dismissing on outside tap.
- `FeedbackState`: icon and loading with stable space, clear title and retry
  disabled while refreshing to prevent repeated requests.
- `PersonAvatar`: initials from first/last name or a fallback icon, reused
  in requests, offers, tracking and rating; the full name remains
  accessible and scalable next to the decorative avatar.
- Offers with price and arrival in a readable block. Profile with name help;
  rating comment based on the shared field, keeping draft,
  counter, limit, hiding and retries.

## Evidence of 2026-09-19

- **373 mobile tests passing**, TypeScript and lint clean;
  `git diff --check` without errors.
- **12 new UI cases**: action/focus locking, field help/error/limit,
  password/non-editable, confirmation/cancellation and retry while loading in
  both themes; dialogs and fields at 200 % on 320×640 and 390×640.
- **41 previous UI cases passing again**: 14 of ride experience,
  23 of negotiation and four of recovery/pagination, for taxi and moto.
  **53 in total**, without JavaScript errors. Screenshots inspected after
  animations finished, including dark theme and large text.
- Real screens, components and hooks were run with network, navigation,
  map, GPS and native contact adapters. It does not certify map,
  keyboard, safe-area or screen-reader behavior on physical devices.
- API/Metro respond HTTP 200. Android bundle of **11,911,693 bytes**, with the
  shared avatar and counter. Existing services kept, without restarts.
- Local gallery verified by opening it from a file, pressing actions and switching
  theme. Plan/presentation at revision 19: 32 slides without overflow;
  navigation, reading, printing and a download identical to the plan verified.
- Backend, contracts and database unchanged in this delivery. Their historical
  evidence remains in revision 17: 731 backend and nine PostgreSQL tests passing.

Interactive gallery and reproducible evidence:
`local-files/shared-components-2026-09-19/`. The gallery uses demo data.
The walkthrough of the current version on two real phones is still pending.
