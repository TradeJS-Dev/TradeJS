const DEFAULT_WEIGHT_PER_MINUTE = 1_000;
const WINDOW_MS = 60_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

type Reservation = { atMs: number; weight: number };

/**
 * Shared rolling-window limiter for Hyperliquid Info API calls. Callers reserve
 * the fixed request cost before fetch and the response-size cost afterwards.
 * Keeping two or fewer requests in flight leaves headroom below the public
 * 1,200 weight/minute IP limit even before the response cost is known.
 */
export class HyperliquidInfoRateLimiter {
  private reservations: Reservation[] = [];
  private queue = Promise.resolve();

  constructor(
    private readonly capacity = DEFAULT_WEIGHT_PER_MINUTE,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  reserve(weight: number): Promise<void> {
    const normalizedWeight = Math.max(1, Math.ceil(weight));
    const pending = this.queue.then(() =>
      this.reserveInternal(normalizedWeight),
    );
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async reserveInternal(weight: number): Promise<void> {
    if (weight > this.capacity) {
      throw new Error(
        `Hyperliquid request weight ${weight} exceeds limiter capacity ${this.capacity}`,
      );
    }
    for (;;) {
      const nowMs = this.now();
      this.reservations = this.reservations.filter(
        (reservation) => reservation.atMs > nowMs - WINDOW_MS,
      );
      const used = this.reservations.reduce(
        (sum, reservation) => sum + reservation.weight,
        0,
      );
      if (used + weight <= this.capacity) {
        this.reservations.push({ atMs: nowMs, weight });
        return;
      }
      const oldest = this.reservations[0];
      await this.wait(Math.max(1, oldest.atMs + WINDOW_MS - nowMs));
    }
  }
}

export const hyperliquidInfoResponseWeight = (rows: number) =>
  Math.max(0, Math.ceil(Math.max(0, rows) / 20));
