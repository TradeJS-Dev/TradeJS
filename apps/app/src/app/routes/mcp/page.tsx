import { Box, Code, Heading, Stack, Text } from '@chakra-ui/react';
import { PageAction, PageHeader, PageLayout } from '#shared/PageLayout';
import { revalidatePath } from 'next/cache';
import { getCurrentUserName } from '#app/lib/currentUser';
import { listConnections, mcpResource, revokeGrant } from '#app/lib/mcp/oauth';

export const dynamic = 'force-dynamic';

async function revoke(form: FormData) {
  'use server';
  const userName = await getCurrentUserName();
  if (!userName) throw new Error('Unauthorized');
  await revokeGrant(userName, String(form.get('grantId') || ''));
  revalidatePath('/routes/mcp');
}

export default async function ConnectionsPage() {
  const userName = await getCurrentUserName();
  if (!userName) return null;
  const connections = await listConnections(userName);
  const url = mcpResource();
  return (
    <PageLayout>
      <Stack gap={4}>
        <PageHeader
          title="MCP connections"
          description="Connect Codex or Claude Code to TradeJS and manage their access."
        />
        <Stack maxW="900px" gap={5}>
          <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">
            Server <Code>{url}</Code>
          </Text>
          <Stack as="section" gap={3}>
            <Heading as="h2" size="md">
              Codex
            </Heading>
            <Command>{`codex mcp add tradejs --url ${url}\ncodex mcp login tradejs`}</Command>
            <Text textStyle="sm" color="fg.muted">
              To run background jobs, sign in with the required permissions.
            </Text>
            <Command>{`codex mcp login tradejs --scopes market:read,market:backfill,runtime:read,backtests:read,backtests:run,diagnostics:read,diagnostics:run,research:read`}</Command>
          </Stack>
          <Stack as="section" gap={3}>
            <Heading as="h2" size="md">
              Claude Code
            </Heading>
            <Command>{`claude mcp add --transport http --scope user tradejs ${url}`}</Command>
            <Text textStyle="sm" color="fg.muted">
              Open <Code>/mcp</Code> in Claude Code to sign in and review the
              requested permissions.
            </Text>
          </Stack>
          <Stack as="section" gap={3}>
            <Heading as="h2" size="md">
              Authorized applications
            </Heading>
            {!connections.length && (
              <Text textStyle="sm" color="fg.muted">
                No active connections.
              </Text>
            )}
            {connections.map((connection) => (
              <Stack
                as="article"
                key={connection.id}
                gap={2}
                p={4}
                bg="gray.800"
                borderWidth="1px"
                borderColor="border"
                borderRadius="lg"
              >
                <Heading as="h3" size="sm">
                  {connection.clientName}
                </Heading>
                <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">
                  {connection.scopes.join(', ')}
                </Text>
                <Text textStyle="sm" color="fg.muted">
                  Expires {new Date(connection.expiresAt).toISOString()}
                </Text>
                <form action={revoke}>
                  <input type="hidden" name="grantId" value={connection.id} />
                  <PageAction type="submit" colorPalette="red">
                    Revoke access
                  </PageAction>
                </form>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Stack>
    </PageLayout>
  );
}

function Command({ children }: { children: string }) {
  return (
    <Box
      as="pre"
      minW={0}
      overflowX="auto"
      p={3}
      bg="gray.800"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      textStyle="sm"
    >
      <code>{children}</code>
    </Box>
  );
}
