'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Flex,
  Heading,
  Input,
  Skeleton,
  SkeletonText,
  Stack,
  Text,
} from '@chakra-ui/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  ResearchStudy,
  ResearchStudyDetail,
} from '#app/lib/researchLibraryTypes';
import { Select } from '#ui';
import { studyKey, studyUrl } from '#app/lib/researchStudyLinks';
import { ResearchStudyView } from './ResearchStudyView';

const ALL_STRATEGIES = '__all__';

const loadJson = async <T,>(url: string, signal: AbortSignal): Promise<T> => {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Research request failed (${response.status})`);
  return response.json();
};

const researchColumns = { base: 'minmax(0, 1fr)', lg: '300px minmax(0, 1fr)' };
const researchGap = { base: 5, lg: 8 };

const StudySkeleton = () => (
  <Stack role="status" aria-label="Loading study" gap={6}>
    <Stack gap={2} borderBottomWidth="1px" borderColor="gray.700" pb={4}>
      <Skeleton h="20px" w="110px" />
      <Skeleton h="36px" w="72%" />
      <Skeleton h="16px" w="185px" maxW="full" />
    </Stack>
    {[0, 1].map((section) => (
      <Stack key={section} gap={3}>
        <Skeleton h="20px" w="125px" />
        <SkeletonText noOfLines={3} gap={2} />
      </Stack>
    ))}
  </Stack>
);

const CatalogSkeleton = () => (
  <Box
    display="grid"
    gridTemplateColumns={researchColumns}
    gap={researchGap}
    alignItems="start"
  >
    <Stack role="status" aria-label="Loading research catalog" gap={3}>
      <Skeleton h="40px" />
      <Skeleton h="32px" />
      <Stack gap={0} borderWidth="1px" borderColor="gray.700" borderRadius="lg">
        {[0, 1, 2, 3].map((row) => (
          <Stack key={row} px={3} py={3} gap={2}>
            <Skeleton h="16px" w="85%" />
            <Skeleton h="12px" w="45%" />
          </Stack>
        ))}
      </Stack>
    </Stack>
    <StudySkeleton />
  </Box>
);

export const ResearchLibrary = () => {
  const router = useRouter();
  const params = useSearchParams();
  const strategy = params.get('strategy') ?? '';
  const studyId = params.get('study');
  const [search, setSearch] = useState('');
  const [studies, setStudies] = useState<ResearchStudy[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [detail, setDetail] = useState<{
    key: string;
    study: ResearchStudyDetail | null;
  } | null>(null);

  useEffect(() => {
    const request = new AbortController();
    void loadJson<{ studies: ResearchStudy[] }>('/api/research', request.signal)
      .then(({ studies: items }) => setStudies(items))
      .catch(() => {
        if (!request.signal.aborted) setCatalogError(true);
      });
    return () => request.abort();
  }, []);

  const strategyItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of studies ?? [])
      counts.set(item.strategy, (counts.get(item.strategy) ?? 0) + 1);
    return [
      { label: 'All strategies', value: ALL_STRATEGIES },
      ...[...counts]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, count]) => ({ label: `${name} (${count})`, value: name })),
    ];
  }, [studies]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (studies ?? []).filter(
      (item) =>
        (!strategy || item.strategy === strategy) &&
        (!query ||
          `${item.title} ${item.strategy}`.toLocaleLowerCase().includes(query)),
    );
  }, [search, strategy, studies]);
  const selected = studyId
    ? (studies ?? []).find((item) => studyKey(item) === studyId)
    : filtered[0];
  const detailKey = selected
    ? new URLSearchParams({
        strategy: selected.strategy,
        study: selected.id,
      }).toString()
    : '';

  useEffect(() => {
    if (!detailKey) return;
    const request = new AbortController();
    void loadJson<{ detail: ResearchStudyDetail }>(
      `/api/research?${detailKey}`,
      request.signal,
    )
      .then(({ detail: item }) => {
        if (!request.signal.aborted) setDetail({ key: detailKey, study: item });
      })
      .catch(() => {
        if (!request.signal.aborted) setDetail({ key: detailKey, study: null });
      });
    return () => request.abort();
  }, [detailKey]);

  const currentDetail = detail?.key === detailKey ? detail : null;
  return (
    <Box
      as="main"
      minH="100vh"
      bg="gray.900"
      pl={2}
      pr={{ base: 4, lg: 8 }}
      py={6}
    >
      <Box maxW="1500px">
        <Flex align="baseline" gap={4} wrap="wrap" mb={5}>
          <Heading as="h1" size="2xl">
            Strategy research
          </Heading>
          {studies && (
            <Text color="gray.400" fontSize="sm">
              {studies.length} studies · {strategyItems.length - 1} groups
            </Text>
          )}
        </Flex>
        {catalogError ? (
          <Text role="alert" color="red.300">
            Could not load the research catalog.
          </Text>
        ) : !studies ? (
          <CatalogSkeleton />
        ) : (
          <Box
            display="grid"
            gridTemplateColumns={researchColumns}
            gap={researchGap}
            alignItems="start"
          >
            <Stack
              as="nav"
              aria-label="Research studies"
              gap={3}
              minW={0}
              position={{ lg: 'sticky' }}
              top={{ lg: 4 }}
            >
              <Select
                aria-label="Filter by strategy"
                placeholder="Strategy"
                defaultValue={[ALL_STRATEGIES]}
                value={[strategy || ALL_STRATEGIES]}
                items={strategyItems}
                width="100%"
                onChange={([value]) =>
                  router.push(
                    studyUrl(value === ALL_STRATEGIES ? undefined : value),
                    {
                      scroll: false,
                    },
                  )
                }
              />
              <Input
                size="sm"
                aria-label="Search studies"
                placeholder="Search studies"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Box
                maxH={{ base: '240px', lg: 'calc(100dvh - 190px)' }}
                overflowY="auto"
                borderWidth="1px"
                borderColor="gray.700"
                borderRadius="lg"
                bg="gray.800"
              >
                {filtered.map((item) => {
                  const active =
                    selected?.id === item.id &&
                    selected.strategy === item.strategy;
                  return (
                    <Box
                      key={`${item.strategy}/${item.id}`}
                      asChild
                      display="block"
                      px={3}
                      py={3}
                      borderBottomWidth="1px"
                      borderBottomColor="gray.700"
                      borderLeftWidth="3px"
                      borderLeftColor={active ? 'teal.300' : 'transparent'}
                      bg={active ? 'teal.950' : undefined}
                      _hover={{ bg: 'gray.700' }}
                      _focusVisible={{
                        outline: '2px solid',
                        outlineColor: 'teal.300',
                        outlineOffset: '-2px',
                      }}
                    >
                      <Link
                        href={studyUrl(strategy, studyKey(item))}
                        prefetch={false}
                        scroll={false}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Text
                          fontSize="sm"
                          fontWeight={active ? 'semibold' : 'medium'}
                        >
                          {item.title}
                        </Text>
                        <Text fontSize="xs" color="gray.400" mt={1}>
                          {item.date} · {item.strategy}
                        </Text>
                      </Link>
                    </Box>
                  );
                })}
                {!filtered.length && (
                  <Text px={3} py={4} color="gray.400" fontSize="sm">
                    No matching studies.
                  </Text>
                )}
              </Box>
            </Stack>
            <Box minW={0}>
              {!selected ? (
                <Text color="gray.400">
                  {studyId
                    ? 'This research study is unavailable.'
                    : studies.length
                      ? 'No studies match the current filters.'
                      : 'No saved research yet.'}
                </Text>
              ) : !currentDetail ? (
                <StudySkeleton />
              ) : currentDetail.study ? (
                <ResearchStudyView
                  key={detailKey}
                  study={currentDetail.study}
                />
              ) : (
                <Text role="alert" color="red.300">
                  Could not load this study.
                </Text>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
