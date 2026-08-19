import { NextResponse } from 'next/server';
import { getRuntimeDeploymentHeartbeat } from '@tradejs/infra/runtimeHeartbeats';
import { listRuntimeDeployments } from '@tradejs/node/runtimeStrategies';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const projectRoot =
    String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
  const deployments = await listRuntimeDeployments({ userName, projectRoot });
  const withHeartbeats = await Promise.all(
    deployments.map(async (deployment) => ({
      ...deployment,
      heartbeat: await getRuntimeDeploymentHeartbeat(userName, deployment.id),
    })),
  );
  return NextResponse.json({ deployments: withHeartbeats });
};
