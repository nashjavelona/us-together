# Us, Together — audit and redesign, v3.0.0

## Release result

The release includes 91 automated test cases across eight files, plus JavaScript syntax, asset-reference, action-wiring, archive, and source checks. The final test suite passes in the default runtime timezone and Asia/Manila. Test details are below; this report distinguishes source and simulated-interaction checks from browser verification.

No supported browser runner was exposed in the environment. No browser screenshot, real touch/keyboard session, browser accessibility scan, installation test, offline test, or simultaneous-tab race test was performed. A temporary browser or alternate browser automation route was not installed. The visual work was reviewed from source, responsive rules, and calculated color pairs.

## Confirmed problems corrected in this release

| Problem | Correction and evidence |
| --- | --- |
| Mobile side selection could disagree with the acting profile | The same action changes the visible side, task-request attribution, check-in owner, and note author. Saved/reloaded profiles align. UI regression covers capture on both sides. |
| Declined shared assignments returned to the sender’s personal list | Requests record their original owner. Decline and cancel restore that original list, including shared tasks; older requests fall back to the sender. Domain tests cover identity, steps, time and recurrence. |
| “Just 5” could become the default 25 minutes after a confirmation | Early-start and extra-hours confirmations carry the selected duration forward. UI regression extracts the actual rendered confirmation metadata and starts five minutes. |
| The card could display five minutes but start 25 at day end | Rendering and start use the same available-window calculation. A 20:55 start with a 21:00 end allocates exactly five minutes. |
| A future recommendation obscured a current appointment | The next-action model prioritizes current protected time and shows the appointment, with a later return to focus. |
| Running or paused work disappeared from the remaining schedule | The planner accounts for unsettled time and the allocated active session, then preserves residual work or overflow. Paused timers reserve no ghost time but retain their workload. |
| “On Friday” behaved like a deadline | “On” schedules from that date; “by” and “before” remain deadlines. A weekday deadline that is today no longer jumps a week ahead. |
| Editing a title or checklist stopped focus | Text and checklist edits preserve the allocated timer. A future-day move or ownership change settles earned time before ending the timer. |
| Rearranging a checklist erased checkmarks | Unchanged labels are matched in occurrence order, including duplicates. New or renamed labels begin unchecked. |
| An already-open editor could partially change a task after its owner changed | Submission re-resolves the task and rejects owner, status, or request changes before applying any fields. The simulated storage-event test also triggers a later save to detect hidden mutation. |
| Accepting for another day could silently miss the deadline | A beyond-deadline date requires explicit permission to move the deadline. Rejection leaves the request unchanged. |
| Shared task duration had no shared timer | Focus together now creates one session constrained by both calendars, day windows and breaks. Personal and shared timers cannot coexist. Shared time is credited once in combined totals. |
| A 30-second estimate remainder could strand unfinished work | New personal and shared focus can allocate a minimum one-minute continuation; real scheduling boundaries still block insufficient windows. Paused timers can finish their remaining seconds. |
| Backup export could count time that happened after export when later restored | Export settles and pauses a deep copy at the export timestamp. The actual running session continues. Later restore cannot credit the copy for intervening time. |
| Older shared help requests displayed dead controls | They now expose usable Focus together and Clear help request controls. Regression starts shared setup and clears the saved request. |
| Help wording suggested a session that had not started | An offer explicitly communicates availability. Taking over changes ownership; a shared task uses the separate real shared-focus action. |
| Success messages claimed a partner request after an ordinary edit | Feedback now checks whether a pending request actually exists. |
| Completed tasks lacked a coherent archive/delete path | Completed tasks can be archived, restored, reopened, or deleted. Archive keeps recorded wins; deletion asks first and offers Undo. Focus time is retained. |
| Form errors appeared behind the native dialog | Errors render in an in-dialog alert region that receives focus. Invalid edits preserve task and timer state. |
| The brand link did not navigate home | The brand uses the app’s view router and returns to Our space. |
| Newly added modules were missing from the offline shell manifest | The service worker cache revision and asset list include together.js and ui-model.js. Runtime offline behavior still needs browser verification. |
| Malformed archived completion fields could break the wins view | Backup validation checks optional completion timestamp/date pairs before accepting state. |

## Design and couple experience

The original black-left / pink-right concept remains, with warmer charcoal and blush panels, an ivory background, berry actions, expressive headings, and paper-like details. The home view now has a concise shared pulse, clearly identified acting profile, and a focused next action for each person.

New couple features are optional daily check-ins, six editable activity ideas, a shared focus session, and a more personal local love-note area. No sample achievements or completed tasks are seeded. Progress combines what the couple has done without ranking partners.

Day plans are collapsed until opened. Capture fields explain whether they create a personal task or a partner request. Request shortcuts, clear empty states, and explicit session/end/task-completion wording reduce ambiguous actions.

Buttons, completion circles, and options controls have at least 44px targets in the stylesheet. Keyboard focus, a skip link, labeled fields, dialog error semantics, reduced-motion support, stronger metadata colors, mobile wrapping, and 16px mobile text inputs were added or improved. Calculated examples include:

| Text/background pair | Calculated contrast |
| --- | ---: |
| Pink-panel secondary text | 5.12:1 |
| Page secondary text | 5.47:1 |
| Dark-panel secondary text | 8.37:1 |
| White text on berry actions | 7.63:1 |
| Activity-card copy | 5.23:1 |
| Love-note copy | 6.07:1 |

These are selected explicit CSS color pairs, not a claim of complete WCAG conformance. Gradients, browser font rendering, focus order, native controls, touch behavior, and actual responsive layout need a real-browser pass.

## Automated coverage

| Test file | Cases | Scope |
| --- | ---: | --- |
| `tests/core.test.js` | 18 | Parsing, deadline/start semantics, schedule capacity, running/paused allocations, shared reservations, recurrence, timestamp accounting and midnight |
| `tests/couple.test.js` | 23 | Ownership, original-list return, requests, deadlines, migration, undo, validation, check-ins, shared transfers and completion |
| `tests/audit.test.js` | 13 | Earlier defect regressions, malformed data, preferred-time gap filling, rest, recurrence and 30 seeded scheduling scenarios |
| `tests/together.test.js` | 16 | Shared availability, both calendars, paused/running conflicts, breaks, outside-hours choice, duration boundaries, exact accounting and continuation |
| `tests/ui-model.test.js` | 11 | Next action, display/start agreement, edit validation, preserved timers, rescheduling, paused backup copies, final seconds and checklist progress |
| `tests/ui-flows.test.js` | 1 | Simulated capture → request → accept → focus/pause/resume → complete/undo → archive/undo → restore and expiry |
| `tests/ui-redesign.test.js` | 8 | Profile identity, rendered early-start metadata, shared timer lifecycle, check-in/activity persistence, in-dialog validation, deletion/undo, old help requests and stale edits |
| `tests/ui-smoke.test.js` | 1 | Initial home, tasks, wins, settings and task-options rendering |
| **Total** | **91** | Eight files; no installed test dependencies |

The UI tests invoke actual app handlers with a small DOM/FormData stub. They verify rendered control metadata and resulting saved state, not browser layout or native interactions.

Final verification commands and checks:

- `npm test`
- `TZ=Asia/Manila node --test tests/*.test.js`
- `node --check` for each distributed JavaScript module
- `git diff --check`
- Local module, app shell, service worker and source archive references exist
- Every static `data-a` action in the app has a delegated handler
- Source ZIP extracts successfully and contains the exact final source, tests and guides
- Sites source synchronization and deployment use the same source commit and packaged assets

## Preserved behavior

The existing Site project, address, localStorage key, task records, editable nicknames, no-sign-in design, and browser-local storage model remain. Existing valid couple backups do not need a database migration. The app never uploads a user’s local task content as part of the source release.

The prior audit’s fixes remain covered: invalid-date capture, recurring occurrence deduplication after transfer, preferred-time gap filling, malformed backup rejection, rolled routine deadlines, timestamp breaks, capture-draft preservation, future-start confirmation, and protected restore preparation.

## Practical limits

- Both people use this shared browser/device. Other devices have separate data; there is no account or cloud synchronization.
- Use one active tab. Storage events update another tab, but simultaneous edits are not transactionally merged.
- JSON backups are the recovery and transfer mechanism. Browser data that is cleared without a backup cannot be recovered by the app.
- Local dates and times follow the device timezone. Day settings currently describe a same-day start and end, not overnight shifts.
- Love notes and help offers are local records. They do not send notifications or messages to another person.
- Sound depends on browser audio policy and an open app. Closed-app alarms are not implemented.
- Routine edits affect future generated occurrences. Existing task occurrences keep their own data.
- Real desktop/mobile rendering, full keyboard and screen-reader behavior, sound, installation and offline use still need browser verification.
