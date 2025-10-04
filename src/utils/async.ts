// Универсальная утилита обхода массива с лимитом параллельных воркеров
export const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  workerFn: (item: T, index: number) => Promise<void>,
) => {
  const queue = items.slice(); // копия, чтобы не мутировать оригинал

  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const index = items.length - queue.length - 1; // порядковый номер
      await workerFn(item, index);
    }
  };

  const workers = Array.from({ length: concurrency }, worker);
  await Promise.all(workers);
};

export const delay = async (delayMs = 1_000) => {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};
