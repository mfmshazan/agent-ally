/**
 * Coordinator — presents a decision on every active channel and returns the
 * first answer. The winning channel's result resolves the decision; the losers
 * are aborted. If every channel fails (e.g. Ctrl+C on the terminal with no
 * phone connected), the whole thing rejects so the handler can fail safe.
 */

import type { Decision, DecisionOption } from "./types.js";
import type { DecisionChannel } from "./channels/types.js";

export type PresentFn = (decision: Decision) => Promise<DecisionOption>;

export function createPresenter(channels: DecisionChannel[]): PresentFn {
  if (channels.length === 0) {
    throw new Error("createPresenter needs at least one channel");
  }

  return (decision: Decision) =>
    new Promise<DecisionOption>((resolve, reject) => {
      const ac = new AbortController();
      let settled = false;
      let failures = 0;
      const errors: unknown[] = [];

      for (const channel of channels) {
        channel.present(decision, ac.signal).then(
          (option) => {
            if (settled) return;
            settled = true;
            ac.abort(); // tell the losing channels to stop
            resolve(option);
          },
          (err) => {
            errors.push(err);
            failures += 1;
            // Only reject once *every* channel has failed — a single channel
            // aborting because another won is expected, not a failure.
            if (!settled && failures === channels.length) {
              settled = true;
              reject(errors[0] ?? new Error("all channels failed"));
            }
          },
        );
      }
    });
}
