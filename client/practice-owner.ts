import {
  PRACTICE_SAVE_KEY,
  savePractice,
  type PracticePace,
} from "./practice-save";
import type { PracticeSession } from "./practice";

export interface PracticeOwner {
  release: () => void;
  matches: () => boolean;
  save: (
    session: PracticeSession,
    checkpoint: PracticeSession | null,
    pace: PracticePace,
  ) => "saved" | "conflict" | "unavailable";
}

type Ownership =
  | { status: "owned"; owner: PracticeOwner }
  | { status: "busy" | "unavailable" };

/** Hold one browser-wide writer for the whole practice, including bot timers.
 * Web Locks are released by the browser on tab termination/reload. No leases or
 * read-then-write localStorage locking: those allow two tabs to win a race.
 */
export function acquirePracticeOwner(): Promise<Ownership> {
  if (!navigator.locks) return Promise.resolve({ status: "unavailable" });
  return new Promise((resolve) => {
    void navigator.locks
      .request("tomato-practice-writer-v1", { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve({ status: "busy" });
          return;
        }
        let expected: string | null;
        try {
          expected = localStorage.getItem(PRACTICE_SAVE_KEY);
        } catch {
          resolve({ status: "unavailable" });
          return;
        }
        return new Promise<void>((unlock) => {
          let active = true;
          const matches = () =>
            active && localStorage.getItem(PRACTICE_SAVE_KEY) === expected;
          resolve({
            status: "owned",
            owner: {
              release() {
                active = false;
                unlock();
              },
              matches,
              save(session, checkpoint, pace) {
                try {
                  // Detect edits made by an older app or external storage tools.
                  if (!matches()) return "conflict";
                  if (!savePractice(session, checkpoint, pace))
                    return "unavailable";
                  expected = localStorage.getItem(PRACTICE_SAVE_KEY);
                  return "saved";
                } catch {
                  return "unavailable";
                }
              },
            },
          });
        });
      })
      .catch(() => resolve({ status: "unavailable" }));
  });
}

/** Keep the exact rejected payload recoverable before a new game replaces it. */
export function preserveRejectedPractice(raw: string): boolean {
  try {
    const key = `tomato-practice-recovery-${Date.now()}-${crypto.randomUUID()}`;
    localStorage.setItem(key, raw);
    return localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}
