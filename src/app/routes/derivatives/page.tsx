'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Heading,
  Text,
  Table,
  HStack,
  Spinner,
  Button,
  Input,
} from '@chakra-ui/react';
import { API } from '@utils/api';

type SummaryResponse = {
  rows: Array<{
    symbol: string;
    interval: string;
    ts: string;
    open_interest: number | null;
    funding_rate: number | null;
    liq_long: number | null;
    liq_short: number | null;
    liq_total: number | null;
  }>;
  aggregates: Array<{
    symbol: string;
    interval: string;
    points: number;
    last_ts: string;
    avg_open_interest: number | null;
    avg_funding_rate: number | null;
    sum_liq_total: number | null;
  }>;
  hours: number;
};

const fmt = (value: number | null | undefined, digits = 4) => {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a';
  return Number(value).toFixed(digits);
};

const DerivativesPage = () => {
  const [hours, setHours] = useState('24');
  const [limit, setLimit] = useState('500');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await API.get<SummaryResponse>(
        `/api/derivatives/summary?hours=${hours}&limit=${limit}`,
      );
      setData(response);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load derivatives');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const aggregates = data?.aggregates ?? [];
    return {
      pairs: aggregates.length,
      points: aggregates.reduce((acc, item) => acc + Number(item.points || 0), 0),
      liq: aggregates.reduce(
        (acc, item) => acc + Number(item.sum_liq_total || 0),
        0,
      ),
    };
  }, [data]);

  return (
    <Box p={6}>
      <Heading size="lg" mb={2}>Derivatives Dashboard</Heading>
      <Text color="gray.500" mb={4}>
        OI / Funding / Liquidations from Timescale (TF 15m, 1h)
      </Text>

      <HStack mb={4}>
        <select
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          style={{
            width: '160px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            padding: '8px',
          }}
        >
          <option value="6">Last 6h</option>
          <option value="24">Last 24h</option>
          <option value="72">Last 72h</option>
          <option value="168">Last 7d</option>
        </select>
        <Input
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          width="160px"
          placeholder="Row limit"
        />
        <Button onClick={load}>Refresh</Button>
      </HStack>

      {loading && <Spinner />}
      {error && (
        <Text color="red.400" mb={4}>
          {error}
        </Text>
      )}

      <Text mb={4}>
        Symbols/TF: {totals.pairs} | Points: {totals.points} | Sum liquidation: {fmt(totals.liq, 2)}
      </Text>

      <Heading size="md" mb={2}>Aggregates</Heading>
      <Box overflowX="auto" mb={8}>
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>symbol</Table.ColumnHeader>
              <Table.ColumnHeader>tf</Table.ColumnHeader>
              <Table.ColumnHeader>points</Table.ColumnHeader>
              <Table.ColumnHeader>last_ts</Table.ColumnHeader>
              <Table.ColumnHeader>avg_oi</Table.ColumnHeader>
              <Table.ColumnHeader>avg_funding</Table.ColumnHeader>
              <Table.ColumnHeader>sum_liq</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data?.aggregates ?? []).map((row) => (
              <Table.Row key={`${row.symbol}:${row.interval}`}>
                <Table.Cell>{row.symbol}</Table.Cell>
                <Table.Cell>{row.interval}</Table.Cell>
                <Table.Cell>{row.points}</Table.Cell>
                <Table.Cell>{row.last_ts ? new Date(row.last_ts).toISOString() : 'n/a'}</Table.Cell>
                <Table.Cell>{fmt(row.avg_open_interest, 2)}</Table.Cell>
                <Table.Cell>{fmt(row.avg_funding_rate, 6)}</Table.Cell>
                <Table.Cell>{fmt(row.sum_liq_total, 2)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>

      <Heading size="md" mb={2}>Latest Points</Heading>
      <Box overflowX="auto">
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>ts</Table.ColumnHeader>
              <Table.ColumnHeader>symbol</Table.ColumnHeader>
              <Table.ColumnHeader>tf</Table.ColumnHeader>
              <Table.ColumnHeader>oi</Table.ColumnHeader>
              <Table.ColumnHeader>funding</Table.ColumnHeader>
              <Table.ColumnHeader>liq_long</Table.ColumnHeader>
              <Table.ColumnHeader>liq_short</Table.ColumnHeader>
              <Table.ColumnHeader>liq_total</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(data?.rows ?? []).slice(0, 200).map((row, idx) => (
              <Table.Row key={`${row.symbol}:${row.interval}:${row.ts}:${idx}`}>
                <Table.Cell>{new Date(row.ts).toISOString()}</Table.Cell>
                <Table.Cell>{row.symbol}</Table.Cell>
                <Table.Cell>{row.interval}</Table.Cell>
                <Table.Cell>{fmt(row.open_interest, 2)}</Table.Cell>
                <Table.Cell>{fmt(row.funding_rate, 6)}</Table.Cell>
                <Table.Cell>{fmt(row.liq_long, 2)}</Table.Cell>
                <Table.Cell>{fmt(row.liq_short, 2)}</Table.Cell>
                <Table.Cell>{fmt(row.liq_total, 2)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Box>
  );
};

export default DerivativesPage;
