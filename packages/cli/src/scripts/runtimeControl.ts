import 'dotenv/config';
import {
  pauseRuntimeStrategy,
  recordRuntimeStrategyControlEvent,
  resumeRuntimeStrategy,
} from '@tradejs/infra/runtimeControls';
import {
  getRuntimeDeployment,
  listRuntimeDeployments,
  loadResolvedRuntimeStrategies,
} from '@tradejs/node/runtimeStrategies';
import type { RuntimeStrategyControlState } from '@tradejs/types';

const argv = process.argv.slice(2);
export const RUNTIME_CONTROL_ACTIONS = [
  'inspect',
  'verify',
  'pause',
  'resume',
] as const;
type RuntimeControlAction = (typeof RUNTIME_CONTROL_ACTIONS)[number];
const action = (argv[0] ?? 'inspect') as RuntimeControlAction;
const option = (name: string) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};
const required = (name: string) => {
  const value = String(option(name) ?? '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
};

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const userName = String(option('user') ?? process.env.USER_NAME ?? 'root');

const verify = async () => {
  const deployments = await listRuntimeDeployments({ userName, projectRoot });
  const requestedDeployment = option('deployment');
  const selected = requestedDeployment
    ? deployments.filter((deployment) => deployment.id === requestedDeployment)
    : deployments;
  if (requestedDeployment && !selected.length) {
    throw new Error(`Runtime deployment not found: ${requestedDeployment}`);
  }
  const results = [];
  for (const deployment of selected) {
    try {
      const strategies = await loadResolvedRuntimeStrategies({
        userName,
        projectRoot,
        deploymentId: deployment.id,
      });
      results.push({
        deploymentId: deployment.id,
        ok: true,
        strategies: strategies.map((strategy) => ({
          strategyName: strategy.strategyName,
          version: strategy.version,
          controlState: strategy.controlState,
          interval: strategy.interval,
          universe: strategy.universe,
          accountId: strategy.accountId,
          strategyPackage: strategy.strategyPackage,
          strategyPackageVersion: strategy.strategyPackageVersion,
          runtimePackageVersion: strategy.runtimePackageVersion,
        })),
      });
    } catch (error) {
      results.push({
        deploymentId: deployment.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log(JSON.stringify({ userName, results }, null, 2));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
};

const inspect = async () => {
  const requestedDeployment = option('deployment');
  const requestedStrategy = option('strategy');
  const deployments = (await listRuntimeDeployments({ userName, projectRoot }))
    .filter(
      (deployment) =>
        !requestedDeployment || deployment.id === requestedDeployment,
    )
    .map((deployment) => ({
      ...deployment,
      strategies: deployment.strategies.filter(
        (strategy) =>
          !requestedStrategy || strategy.strategyName === requestedStrategy,
      ),
    }));
  console.log(JSON.stringify({ userName, deployments }, null, 2));
};

const updateControlState = async (nextState: RuntimeStrategyControlState) => {
  const deploymentId = required('deployment');
  const strategyName = required('strategy');
  const deployment = await getRuntimeDeployment({
    userName,
    projectRoot,
    deploymentId,
  });
  if (!deployment) {
    throw new Error(`Runtime deployment not found: ${deploymentId}`);
  }
  const reference = deployment.strategies.find(
    (strategy) => strategy.strategyName === strategyName,
  );
  if (!reference) {
    throw new Error(`${strategyName} is not declared in ${deploymentId}`);
  }
  if (nextState === 'active' && (!deployment.enabled || !reference.enabled)) {
    throw new Error(
      `${strategyName} is disabled in tradejs.config.ts and cannot be resumed manually`,
    );
  }
  const previousState = reference.controlState;
  if (nextState === 'entries_paused') {
    await pauseRuntimeStrategy({
      userName,
      deploymentId,
      strategyName,
      updatedBy: `cli:${userName}`,
    });
  } else {
    await resumeRuntimeStrategy({ userName, deploymentId, strategyName });
  }
  const updated = await getRuntimeDeployment({
    userName,
    projectRoot,
    deploymentId,
  });
  const updatedReference = updated?.strategies.find(
    (strategy) => strategy.strategyName === strategyName,
  );
  const event =
    previousState === nextState
      ? null
      : await recordRuntimeStrategyControlEvent({
          userName,
          deploymentId,
          strategyName,
          version: reference.version,
          previousState,
          nextState,
          createdBy: `cli:${userName}`,
        });
  console.log(
    JSON.stringify(
      { deployment: updated, strategy: updatedReference, event },
      null,
      2,
    ),
  );
};

export const runtimeControl = async () => {
  if (action === 'verify') return verify();
  if (action === 'pause') return updateControlState('entries_paused');
  if (action === 'resume') return updateControlState('active');
  if (action === 'inspect') return inspect();
  throw new Error(
    `Usage: tradejs runtime-control ${RUNTIME_CONTROL_ACTIONS.join('|')}`,
  );
};

export const main = runtimeControl;
