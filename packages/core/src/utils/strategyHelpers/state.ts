export interface LastTradeController {
  isInCooldown: (timestamp: number) => boolean;
  markTrade: (timestamp: number) => void;
  getLastTradeTimestamp: () => number | null;
}

export interface CreateLastTradeControllerParams {
  env?: string;
  enabled?: boolean;
  cooldownMs?: number;
}

export const createLastTradeController = ({
  env,
  enabled = env ? env === 'BACKTEST' : true,
  cooldownMs = 86_400_000,
}: CreateLastTradeControllerParams): LastTradeController => {
  let lastTradeTimestamp: number | null = null;

  return {
    isInCooldown: (timestamp: number) =>
      Boolean(
        enabled &&
          lastTradeTimestamp != null &&
          timestamp <= lastTradeTimestamp + cooldownMs,
      ),
    markTrade: (timestamp: number) => {
      if (!enabled) return;
      lastTradeTimestamp = timestamp;
    },
    getLastTradeTimestamp: () => lastTradeTimestamp,
  };
};
