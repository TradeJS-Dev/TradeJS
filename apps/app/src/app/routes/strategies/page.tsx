import { redirect } from 'next/navigation';

const StrategiesPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const params = new URLSearchParams();

  for (const [name, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) {
        params.append(name, item);
      }
    }
  }

  const query = params.toString();
  redirect(
    query
      ? `/routes/strategies/runtime?${query}`
      : '/routes/strategies/runtime',
  );
};

export default StrategiesPage;
