import styles from '#app/lib/mcp/Mcp.module.css';
import { getCurrentUserName } from '#app/lib/currentUser';
import { readConsent } from '#app/lib/mcp/oauth';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  const { ticket = '' } = await searchParams;
  const userName = await getCurrentUserName();
  const consent = await readConsent(ticket);
  if (!consent || consent.userName !== userName)
    return (
      <main style={{ padding: 32 }}>
        Authorization request expired. Start the connection again.
      </main>
    );
  return (
    <main className={styles.main}>
      <h1>Connect to TradeJS</h1>
      <p>
        <strong>{consent.client.name}</strong> requests access as{' '}
        <strong>{userName}</strong>.
      </p>
      <p>The client name is supplied by the application requesting access.</p>
      <p>
        Return address: <code>{consent.query.redirect_uri}</code>
      </p>
      <p>
        Market and runtime data you request will be shared with this client. Run
        permissions allow background computations. They do not allow live
        trading or deployment changes.
      </p>
      <form action="/oauth/authorize" method="post">
        <input type="hidden" name="ticket" value={ticket} />
        <fieldset>
          <legend>Requested permissions</legend>
          {consent.scopes.map((scope) => (
            <label key={scope} style={{ display: 'block', margin: '8px 0' }}>
              <input
                type="checkbox"
                name="scope"
                value={scope}
                defaultChecked={!scope.endsWith(':run')}
              />{' '}
              {scope}
            </label>
          ))}
        </fieldset>
        <button name="decision" value="allow" type="submit">
          Allow access
        </button>{' '}
        <button name="decision" value="deny" type="submit">
          Deny
        </button>
      </form>
      <p>
        You can revoke access in <Link href="/routes/mcp">MCP connections</Link>
        .
      </p>
    </main>
  );
}
