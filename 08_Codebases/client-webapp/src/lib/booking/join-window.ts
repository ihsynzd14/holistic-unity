/**
 * Single source of truth for when a video room is reachable.
 *
 * Policy (matches the agreement with users):
 *   - Opens 15 minutes BEFORE the scheduled time so people can settle in
 *   - Stays open for a total of 3 HOURS so a mid-session crash, a slow
 *     network reconnect, or a session that just runs long doesn't lock
 *     anyone out
 *   - Therapist and client see exactly the same window
 *
 * Outside this window the "Entra" CTA is hidden, the API route guards
 * the LiveKit token mint, and the call page itself shows a friendly
 * "non ancora aperta" / "sessione conclusa" message instead of an
 * unbounded loading spinner.
 *
 * Keep this file dependency-free so it works in client components,
 * server components, and route handlers alike.
 */

export const JOIN_WINDOW_OPEN_MINUTES_BEFORE = 15;
export const JOIN_WINDOW_DURATION_MINUTES = 180; // 3 hours total

export type JoinWindowState =
  | { state: "too_early"; minutesUntilOpen: number }
  | { state: "open"; minutesUntilClose: number }
  | { state: "closed" };

export function getJoinWindow(
  scheduledAt: Date | string,
  now: Date = new Date(),
): JoinWindowState {
  const scheduled =
    typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;

  const opensAt = new Date(
    scheduled.getTime() - JOIN_WINDOW_OPEN_MINUTES_BEFORE * 60_000,
  );
  const closesAt = new Date(
    opensAt.getTime() + JOIN_WINDOW_DURATION_MINUTES * 60_000,
  );

  if (now < opensAt) {
    return {
      state: "too_early",
      minutesUntilOpen: Math.ceil(
        (opensAt.getTime() - now.getTime()) / 60_000,
      ),
    };
  }
  if (now >= closesAt) {
    return { state: "closed" };
  }
  return {
    state: "open",
    minutesUntilClose: Math.ceil(
      (closesAt.getTime() - now.getTime()) / 60_000,
    ),
  };
}

export function isJoinWindowOpen(
  scheduledAt: Date | string,
  now: Date = new Date(),
): boolean {
  return getJoinWindow(scheduledAt, now).state === "open";
}
