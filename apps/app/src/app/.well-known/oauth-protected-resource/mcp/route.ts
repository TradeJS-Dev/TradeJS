import { protectedResourceMetadata, oauthResponse } from '#app/lib/mcp/oauth';
export const dynamic = 'force-dynamic';
export const GET = () => oauthResponse(protectedResourceMetadata());
