const getRuntimeWorkspaceDependencies = (manifest, workspaceNames) =>
  Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  }).filter((dependency) => workspaceNames.has(dependency));

const buildManifestWorkspaceGraph = (packages) => {
  const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));

  return new Map(
    packages.map(({ manifest }) => [
      manifest.name,
      new Set(getRuntimeWorkspaceDependencies(manifest, workspaceNames)),
    ]),
  );
};

const findWorkspaceDependencyCycles = (graph) => {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const path = [];

  const visit = (packageName) => {
    if (visiting.has(packageName)) {
      const cycleStart = path.indexOf(packageName);
      cycles.push([...path.slice(cycleStart), packageName]);
      return;
    }
    if (visited.has(packageName)) return;

    visiting.add(packageName);
    path.push(packageName);
    for (const dependency of graph.get(packageName) ?? []) {
      visit(dependency);
    }
    path.pop();
    visiting.delete(packageName);
    visited.add(packageName);
  };

  for (const packageName of graph.keys()) visit(packageName);
  return cycles;
};

const validateManifestWorkspaceGraph = ({
  packages,
  allowedWorkspaceDependencies,
}) => {
  const errors = [];
  const graph = buildManifestWorkspaceGraph(packages);

  for (const { manifest } of packages) {
    const allowed = allowedWorkspaceDependencies.get(manifest.name);
    if (!allowed) continue;

    for (const dependency of graph.get(manifest.name) ?? []) {
      if (!allowed.has(dependency)) {
        errors.push(
          `${manifest.name}: forbidden runtime manifest dependency ${manifest.name} -> ${dependency}`,
        );
      }
    }
  }

  for (const cycle of findWorkspaceDependencyCycles(graph)) {
    errors.push(`workspace manifest dependency cycle: ${cycle.join(' -> ')}`);
  }

  return { errors, graph };
};

module.exports = {
  buildManifestWorkspaceGraph,
  findWorkspaceDependencyCycles,
  getRuntimeWorkspaceDependencies,
  validateManifestWorkspaceGraph,
};
