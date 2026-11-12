'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  Link,
  Stack,
  Text,
  chakra,
} from '@chakra-ui/react';
import { FiExternalLink } from 'react-icons/fi';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ResearchChart,
  ResearchStudyDetail,
} from '#app/lib/researchLibraryTypes';

const numberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const colors = [
  '#4fd1c5',
  '#9f9fff',
  '#f6ad55',
  '#68d391',
  '#f687b3',
  '#63b3ed',
];

const EquityChart = ({ chart }: { chart: ResearchChart }) => {
  const data = useMemo(() => {
    const rows = new Map<number, Record<string, number>>();
    chart.series.forEach(({ points }, index) => {
      for (const [timestamp, value] of points) {
        const row = rows.get(timestamp) ?? { timestamp };
        row[`series-${index}`] = value;
        rows.set(timestamp, row);
      }
    });
    return [...rows.values()].sort(
      (left, right) => left.timestamp - right.timestamp,
    );
  }, [chart.series]);

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.700"
      borderRadius="lg"
      bg="gray.900"
      p={4}
    >
      <Heading as="h3" size="sm" mb={3}>
        {chart.title}
      </Heading>
      <Box h="320px" minW={0}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 6, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--chakra-colors-gray-700)"
            />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={[chart.start, chart.end]}
              allowDataOverflow
              tickFormatter={(value) => dateFormat.format(value)}
            />
            <YAxis
              width={62}
              tickFormatter={(value) => numberFormat.format(value)}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--chakra-colors-gray-800)',
                borderColor: 'var(--chakra-colors-gray-600)',
              }}
              labelFormatter={(value) =>
                new Date(Number(value)).toISOString().slice(0, 10)
              }
              formatter={(value) =>
                `${numberFormat.format(Number(value))} ${chart.unit}`.trim()
              }
            />
            <Legend />
            {chart.series.map(({ label }, index) => (
              <Line
                key={`series-${index}`}
                dataKey={`series-${index}`}
                name={label}
                type="stepAfter"
                stroke={colors[index % colors.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
};

const plainText = (text: string) =>
  text
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*|`([^`]+)`/g, (_, bold, code) => bold ?? code);

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => plainText(cell.trim().replace(/\\\|/g, '|')));

const ReportText = ({ text }: { text: string }) => {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; ) {
    const line = lines[index++].trim();
    if (!line) continue;
    if (
      line.startsWith('|') &&
      /^\|\s*:?-{2,}/.test(lines[index]?.trim() ?? '')
    ) {
      const headers = tableCells(line);
      const rows = [];
      index++;
      while (lines[index]?.trim().startsWith('|'))
        rows.push(tableCells(lines[index++]));
      blocks.push(
        <Box
          key={index}
          overflowX="auto"
          borderWidth="1px"
          borderColor="gray.700"
          borderRadius="md"
          css={{
            '& table': {
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 'sm',
            },
            '& th, & td': {
              borderBottomWidth: '1px',
              borderColor: 'gray.700',
              padding: '8px 12px',
              textAlign: 'start',
            },
            '& th': { bg: 'gray.800', color: 'gray.100', whiteSpace: 'nowrap' },
            '& td': { fontVariantNumeric: 'tabular-nums' },
            '& tr:last-child td': { borderBottomWidth: 0 },
          }}
        >
          <table>
            <thead>
              <tr>
                {headers.map((cell, column) => (
                  <th scope="col" key={column}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, column) => (
                    <td key={column}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>,
      );
      continue;
    }
    if (/^#{2,}\s/.test(line)) {
      blocks.push(
        <Heading as="h3" size="sm" mt={2} key={index}>
          {plainText(line.replace(/^#+\s+/, ''))}
        </Heading>,
      );
      continue;
    }
    if (/^(?:`{3,}|~{3,})/.test(line)) {
      const code = [];
      while (
        index < lines.length &&
        !/^(?:`{3,}|~{3,})/.test(lines[index].trim())
      )
        code.push(lines[index++]);
      index++;
      blocks.push(
        <Box
          as="pre"
          key={index}
          p={3}
          bg="gray.900"
          borderRadius="md"
          overflowX="auto"
          fontSize="xs"
        >
          {code.join('\n')}
        </Box>,
      );
      continue;
    }
    blocks.push(
      <Text key={index} color="gray.200" fontSize="sm" overflowWrap="anywhere">
        {plainText(line.replace(/^[-*]\s+/, '• '))}
      </Text>,
    );
  }
  return <Stack gap={3}>{blocks}</Stack>;
};

const artifactUrl = (study: ResearchStudyDetail, artifact: string) =>
  `/api/research?${new URLSearchParams({ strategy: study.strategy, study: study.id, artifact })}`;

export const ResearchStudyView = ({
  study,
}: {
  study: ResearchStudyDetail;
}) => {
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const charts = study.artifacts.filter(({ kind }) => kind === 'chart');
  const reports = study.artifacts.filter(({ kind }) => kind === 'report');
  const summary = study.sections.filter(
    ({ title }) => title === 'Research question' || title === 'Decision',
  );
  const results = study.sections.filter(
    (section) => !summary.includes(section),
  );

  return (
    <Stack as="article" gap={6} minW={0}>
      <Box borderBottomWidth="1px" borderColor="gray.700" pb={4}>
        <Text fontSize="sm" color="teal.300" fontWeight="semibold">
          {study.strategy}
        </Text>
        <Heading as="h2" size="xl" mt={1} overflowWrap="anywhere">
          {study.title}
        </Heading>
        <Flex gap={3} mt={2} color="gray.400" fontSize="sm" wrap="wrap">
          <Text>{study.date}</Text>
          {study.kind && <Text>{study.kind}</Text>}
          {study.status && <Text>{study.status}</Text>}
        </Flex>
      </Box>
      {summary.map(({ title, text }) => (
        <Box as="section" key={title}>
          <Heading as="h3" size="sm" mb={2}>
            {title}
          </Heading>
          <ReportText text={text} />
        </Box>
      ))}
      {(study.chart || charts.length > 0 || reports.length > 0) && (
        <Stack as="section" gap={3}>
          <Heading as="h3" size="md">
            Charts and reports
          </Heading>
          {study.chart && <EquityChart chart={study.chart} />}
          {charts.map(({ id, label }) => (
            <Box
              as="figure"
              key={id}
              m={0}
              p={3}
              borderWidth="1px"
              borderColor="gray.700"
              borderRadius="lg"
              bg="gray.900"
            >
              <Link
                href={artifactUrl(study, id)}
                target="_blank"
                rel="noopener noreferrer"
                display="block"
              >
                <chakra.img
                  src={artifactUrl(study, id)}
                  alt={label}
                  loading="lazy"
                  maxW="full"
                  maxH="620px"
                  mx="auto"
                  objectFit="contain"
                />
              </Link>
              <Text as="figcaption" color="gray.400" fontSize="sm" mt={2}>
                {label}
              </Text>
            </Box>
          ))}
          {reports.map(({ id, label }) => (
            <Flex key={id} gap={3} align="center" wrap="wrap">
              <Button
                size="sm"
                variant={activeReport === id ? 'solid' : 'outline'}
                aria-expanded={activeReport === id}
                onClick={() => setActiveReport(activeReport === id ? null : id)}
              >
                {label}
              </Button>
              <Link
                href={artifactUrl(study, id)}
                target="_blank"
                rel="noopener noreferrer"
                color="teal.300"
                fontSize="sm"
              >
                Open report <FiExternalLink aria-hidden="true" />
              </Link>
            </Flex>
          ))}
          {activeReport && (
            <iframe
              title="Research report"
              src={artifactUrl(study, activeReport)}
              sandbox=""
              style={{
                width: '100%',
                height: 660,
                border: 0,
                background: 'white',
              }}
            />
          )}
        </Stack>
      )}
      {results.map(({ title, text }) => (
        <Box as="section" key={title}>
          <Heading as="h3" size="md" mb={3}>
            {title}
          </Heading>
          <ReportText text={text} />
        </Box>
      ))}
    </Stack>
  );
};
