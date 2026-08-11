import { NextResponse } from 'next/server';
import {
  deleteRuntimeDeployment,
  getRuntimeDeployment,
} from '@tradejs/infra/runtimeDeployments';
import { getCurrentUserName } from '#app/lib/currentUser';

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ deploymentId: string }> },
) => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { deploymentId } = await params;
  if (!(await getRuntimeDeployment(userName, deploymentId))) {
    return NextResponse.json(
      { error: 'Deployment not found' },
      { status: 404 },
    );
  }
  await deleteRuntimeDeployment(userName, deploymentId);
  return NextResponse.json({ deleted: true });
};
