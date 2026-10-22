# Practice and mobile review

Base: `b73e4f9461c1434b47662d0c904c67e43e7bf5cb`, on `feat/first-playable`. The existing practice, audio, three-consecutive-pairs hints, keyboard shortcuts, and legal-play checks are retained. This change also includes the requested mouse drag selection.

## Reproduction notes

| Issue               | Evidence before the fix                                                                                                                                                                                                                          | Classification                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Cross-tab save loss | Tab A cached a 17-card Dou Dizhu save in the lobby. Tab B resumed and bid 3, reaching 20 cards. Continuing in A restored 17 cards, wrote 17 to localStorage, and B also restored 17 after reload. All three assertions expecting 20 failed.      | Confirmed data-loss bug                                                             |
| Mobile controls     | At scroll position 0, practice controls used 124px in portrait and about 127px in landscape. Guandan's action bar began at document y≈1135 in 390×844; landscape hands and actions were below the initial 844×390 viewport.                      | Confirmed usability problem; layout improvement                                     |
| Move coach          | On the exact base component, a single 3 against 9 had `canPlay: false` but was described as an invalid pattern. A legal K against 9 with `isMyTurn: false` still encouraged Play. Props were computed with the original shared legality helpers. | Confirmed incorrect guidance                                                        |
| Invalid saved phase | A fault-injected Guandan `phase: "tribute"`, `tribute: null` payload was accepted. A selected tribute card absent from its contributor's hand was also accepted.                                                                                 | Confirmed validation defects under fault injection; not observed during normal play |

The cross-tab and malformed-save cases were reproduced before their production fixes, and the mobile screenshots were captured before changing the layout. The initial coaching patch was made before its executable reproduction; that case was subsequently replayed against the exact `b73e4f9` component in an isolated checkout ([original output and inputs](evidence/practice-review/move-coach-before.json)). This is a workflow deviation from the requested reproduce-first sequence, not a claim that the patched version reproduced the old bug.

## Changes

- Practice holds one exclusive Web Lock for its active lifetime. A second tab explains that the practice is already open without modifying its save. Resume reads storage again after acquiring ownership. Returning to the lobby, entering multiplayer, closing, and reloading release ownership. Concurrent starts and resumes cannot both become writers.
- Storage events refresh lobby metadata. An external save replacement pauses the active practice and blocks subsequent writes. Browsers without safe ownership support can play in memory without overwriting the existing save.
- Invalid and unsupported saves retain their exact raw contents. The lobby explains the problem and offers a download. Starting a new practice first creates a separate `tomato-practice-recovery-*` backup; a failed backup prevents replacement. Failed writes are never presented as a newly saved game.
- Save validation checks phase-dependent tribute, return, discard, bidding, and finished-state invariants, as well as card conservation and checkpoint compatibility.
- Coaching distinguishes card-pattern validity, ability to beat the current trick, turn restrictions, pause, and exchange phases.
- Mobile play uses a fixed action area with safe-area padding and reserved scrolling space. Portrait tables are shorter; landscape puts the hand beside the table. Speed and undo are behind a disclosure, while pause remains directly available. Dialogs sit above the action area.
- Holding the left mouse button and dragging selects the inclusive card range. Starting on a selected card clears the range; reversing shrinks it and restores the prior state outside the range. Ordinary clicks, keyboard activation, touch taps, and touch scrolling remain available.

## Verification and screenshots

| Command                                                                                                            | Result                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                                    | Passed after the final production edit: TypeScript, ESLint, 234 unit tests in 10 files, and the Vite production build. This retains the 219-test baseline and adds 15 unit regressions. |
| `npx playwright test`                                                                                              | 36/36 passed in 15.1 minutes, with no retries. Retains the original 16 scenarios and adds 20 browser regressions.                                                                       |
| `npx playwright test tests/e2e/mobile-controls.spec.ts tests/e2e/practice.spec.ts tests/e2e/practice-tabs.spec.ts` | Focused save, coaching and mobile pass: 16/16 in 42.2 seconds.                                                                                                                          |
| `npx playwright test tests/e2e/mobile-controls.spec.ts tests/e2e/drag-selection.spec.ts`                           | Final layout and drag recheck: 9/9 in 18.7 seconds, including the entire starting hand above the action bar before scrolling.                                                           |

Verification sequence: the full 36-scenario run passed, then screenshot review prompted a final CSS spacing/safe-area adjustment. Before that adjustment, the stronger initial-hand assertion reproduced two remaining Guandan overlaps (36px portrait, 38px landscape). After the adjustment, all nine mobile/drag scenarios and `npm run check` passed again. The other production code was unchanged after the full suite.

Coverage includes:

- Two tabs sharing storage: stale lobby, concurrent resumes, owner reload/close, and ownership transfer; external replacement pauses further writes. Missing Web Locks preserves the durable save while playing in memory. Failed backups refuse replacement.
- Malformed JSON, unsupported versions, incomplete/phase-inconsistent saves, and valid complete-game saves. Undo checkpoints, pause, all three bot delays (450/1050/1800ms), normal resume, and practice ↔ multiplayer transitions with reloads remain covered.
- Valid but weak single 3 against 9, invalid/mismatched patterns, bot turns, pause, and special phases. Existing three-consecutive-pairs hints, focused-card/button H/Esc shortcuts, native Enter behavior, and disabled invalid submission passed.
- Complete multiplayer rounds through normal UI: Dou Dizhu took 70 legal actions; Guandan took 485 across two completed hands because the first next deal resisted tribute. The following hand completed double tribute, both returns, one discard and one skip, with portrait/landscape participants and reconnects after tribute and discard. Private-card isolation and browser/command error assertions passed. [Generated round evidence](evidence/practice-review/e2e-results.json).
- Both games at 390×844 and 844×390: all starting cards visible above the primary action area; every card can also be scrolled/focused without obstruction; settings dialogs retain focus above the action area. Mouse range selection covers reverse movement, clearing ranges, fast sweeps, wrapped rows, outside release and preserved touch scrolling.

These screenshots use Chromium browser emulation at scroll position 0. Dou Dizhu's baseline screenshot is during bidding (17 cards); its updated screenshot is after bidding 3 (20 cards). Guandan starts with 27 cards in both versions. The deals are different; the comparison is of layout and action access.

| Game / viewport    | Before                                                                       | After                                                                       |
| ------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Guandan, 390×844   | [Portrait](evidence/practice-review/before/guandan-portrait-viewport.png)    | [Portrait](evidence/practice-review/after/guandan-portrait-viewport.png)    |
| Guandan, 844×390   | [Landscape](evidence/practice-review/before/guandan-landscape-viewport.png)  | [Landscape](evidence/practice-review/after/guandan-landscape-viewport.png)  |
| Dou Dizhu, 390×844 | [Portrait](evidence/practice-review/before/doudizhu-portrait-viewport.png)   | [Portrait](evidence/practice-review/after/doudizhu-portrait-viewport.png)   |
| Dou Dizhu, 844×390 | [Landscape](evidence/practice-review/before/doudizhu-landscape-viewport.png) | [Landscape](evidence/practice-review/after/doudizhu-landscape-viewport.png) |

Additional portrait screenshots show played cards between the seats: [Guandan](evidence/practice-review/after/guandan-portrait-trick.png), [Dou Dizhu](evidence/practice-review/after/doudizhu-portrait-trick.png). The [baseline metrics](evidence/practice-review/before/metrics.json) retain the off-screen action positions.

At scroll position 0, Guandan's hand now begins at y≈543 in portrait and y≈182 in landscape, versus y≈824 and y≈757 before. The primary action area is fixed at y≈772–844 and y≈324–390 respectively. The practice strip shrank from 124/127.5px to 55.5/51.5px. Final measurements: [Guandan portrait](evidence/practice-review/after/guandan-portrait.json), [Guandan landscape](evidence/practice-review/after/guandan-landscape.json), [Dou Dizhu portrait](evidence/practice-review/after/doudizhu-portrait.json), [Dou Dizhu landscape](evidence/practice-review/after/doudizhu-landscape.json).

## Limits

- Browser checks use Chromium viewport and touch emulation, not physical iPhone/iPad testing or Safari certification.
- At other viewport sizes, expanded settings, longer content, or increased text size, scrolling may still be needed. The fixed action area has measured bottom reserve and per-card scroll margins; not every table detail or coaching message fits alongside the hand in the initial landscape viewport.
- Practice storage remains local to this browser. Only one tab can actively own it; there is no cross-device cloud sync. When Web Locks or storage are unavailable, practice is explicitly unsaved.
- Web Locks coordinate tabs running this version. External tools or already-open legacy code do not honor that lock; changes detected before a write pause the practice, but localStorage cannot make the comparison and write atomic against an uncoordinated writer.
- Recovery backups remain in localStorage and are not automatically imported. The download preserves the original bytes for later repair or a compatible app version.
- No Cloudflare deployment, credential changes, or paid services were used.
