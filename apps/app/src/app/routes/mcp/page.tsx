import styles from '#app/lib/mcp/Mcp.module.css';
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
    <main className={styles.main}>
      <h1>MCP connections</h1>
      <p>
        Connect Codex or Claude Code to your TradeJS instance. Sign in and
        review access in your browser.
      </p>
      <p>
        Server: <code>{url}</code>
      </p>
      <h2>Codex</h2>
      <pre>{`codex mcp add tradejs --url ${url}\ncodex mcp login tradejs`}</pre>
      <p>
        For background jobs, authorize the required run permissions yourself:
      </p>
      <pre>{`codex mcp login tradejs --scopes market:read,runtime:read,backtests:read,backtests:run,diagnostics:read,diagnostics:run`}</pre>
      <h2>Claude Code</h2>
      <pre>{`claude mcp add --transport http --scope user tradejs ${url}`}</pre>
      <p>
        In Claude Code, open <code>/mcp</code> to authenticate. Request
        additional scopes explicitly when you need to run computations.
      </p>
      <h2>Authorized applications</h2>
      {!connections.length && <p>No active connections.</p>}
      {connections.map((connection) => (
        <section key={connection.id} className={styles.connection}>
          <h3>{connection.clientName}</h3>
          <p>{connection.scopes.join(', ')}</p>
          <p>Expires: {new Date(connection.expiresAt).toISOString()}</p>
          <form action={revoke}>
            <input type="hidden" name="grantId" value={connection.id} />
            <button type="submit">Revoke access</button>
          </form>
        </section>
      ))}
    </main>
  );
}
