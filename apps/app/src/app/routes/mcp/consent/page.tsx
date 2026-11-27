import { Box, Code, Field, Flex, Input, Stack, Text } from '@chakra-ui/react';
import { AuthenticatorCodeField } from '#shared/AuthenticatorCodeField';
import { PageAction, PageHeader, PageLayout } from '#shared/PageLayout';
import { getCurrentUserName } from '#app/lib/currentUser';
import { readConsent } from '#app/lib/mcp/oauth';
import { actionConfirmationMethod } from '#app/lib/actionConfirmation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{
    ticket?: string;
    confirmation?: string;
    scope?: string | string[];
  }>;
}) {
  const { ticket = '', confirmation, scope } = await searchParams;
  const userName = await getCurrentUserName();
  const consent = await readConsent(ticket);
  if (!userName || !consent || consent.userName !== userName)
    return (
      <PageLayout maxW="680px" mx="auto">
        <PageHeader
          title="Connection expired"
          description="Start the connection again in your app."
        />
      </PageLayout>
    );
  const method = await actionConfirmationMethod(userName);
  const retry = confirmation === 'retry' || confirmation === 'limited';
  const selected = typeof scope === 'string' ? [scope] : scope ?? [];
  return (
    <PageLayout maxW="680px" mx="auto">
      <Stack gap={4}>
        <PageHeader title="Connect to TradeJS" />
        <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">
          <strong>{consent.client.name}</strong> requests access as{' '}
          <strong>{userName}</strong>.
        </Text>
        <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">
          The client name is supplied by the application requesting access.
        </Text>
        <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">
          Return address: <Code>{consent.query.redirect_uri}</Code>
        </Text>
        <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">
          Market and runtime data you request will be shared with this client.
          Run permissions allow background computations. They do not allow live
          trading or deployment changes.
        </Text>
        <form action="/oauth/authorize" method="post">
          <input type="hidden" name="ticket" value={ticket} />
          <Box
            as="fieldset"
            p={3}
            borderWidth="1px"
            borderColor="border"
            borderRadius="md"
          >
            <legend>Requested permissions</legend>
            {consent.scopes.map((scope) => (
              <Flex
                as="label"
                key={scope}
                align="center"
                gap={2}
                py={1}
                textStyle="sm"
              >
                <input
                  type="checkbox"
                  name="scope"
                  value={scope}
                  defaultChecked={
                    retry
                      ? selected.includes(scope)
                      : !scope.endsWith(':run') && scope !== 'market:backfill'
                  }
                />{' '}
                {scope}
              </Flex>
            ))}
          </Box>
          <input type="hidden" name="confirmationMethod" value={method} />
          {method === 'password' ? (
            <Field.Root mt={3}>
              <Field.Label>Current password</Field.Label>
              <Input
                name="confirmation"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field.Root>
          ) : (
            <Box mt={3}>
              <AuthenticatorCodeField
                name="confirmation"
                submitterId="allow-mcp-access"
                required
              />
            </Box>
          )}
          {retry && (
            <Text role="alert" fontSize="sm" mt={2}>
              {confirmation === 'limited'
                ? 'Too many attempts. Try again in five minutes.'
                : 'Confirmation failed. Try again.'}
            </Text>
          )}
          <Flex gap={2} mt={3}>
            <PageAction
              variant="solid"
              colorPalette="teal"
              id="allow-mcp-access"
              name="decision"
              value="allow"
              type="submit"
            >
              Allow access
            </PageAction>
            <PageAction
              name="decision"
              value="deny"
              type="submit"
              formNoValidate
            >
              Deny
            </PageAction>
          </Flex>
        </form>
        <Text textStyle="sm" color="fg.muted" overflowWrap="anywhere">
          You can revoke access in{' '}
          <Box asChild textDecoration="underline">
            <Link href="/routes/mcp">MCP connections</Link>
          </Box>
          .
        </Text>
      </Stack>
    </PageLayout>
  );
}
