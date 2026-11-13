'use client';

import { ClientOnly, Stack } from '@chakra-ui/react';
import { PageHeader, PageLayout } from '#shared/PageLayout';
import { Select } from '#ui';
import { HOURS_OPTIONS } from './derivativesDashboardConfig';
import { DerivativesDashboardView } from './DerivativesDashboardView';
import { useDerivativesDashboard } from './useDerivativesDashboard';

const DerivativesPage = () => {
  const { hours, setHours, chartWindow, dashboard } = useDerivativesDashboard();

  return (
    <ClientOnly>
      <PageLayout>
        <Stack gap={4}>
          <PageHeader
            title="Derivatives"
            actions={
              <Select
                aria-label="Window"
                placeholder="Window"
                defaultValue={[hours]}
                value={[hours]}
                onChange={(value) => setHours(value[0] || '24')}
                items={HOURS_OPTIONS}
                width="180px"
              />
            }
          />
          <DerivativesDashboardView
            dashboard={dashboard}
            chartWindow={chartWindow}
          />
        </Stack>
      </PageLayout>
    </ClientOnly>
  );
};

export default DerivativesPage;
