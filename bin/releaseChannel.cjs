'use strict';

const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const BETA_VERSION = /^(\d+)\.(\d+)\.(\d+)-beta\.([1-9]\d*)$/;

const resolveBetaVersion = (stableVersion, runNumber) => {
  const match = STABLE_VERSION.exec(String(stableVersion).trim());
  if (!match) {
    throw new Error(`Stable baseline is required: ${stableVersion}`);
  }
  if (!/^[1-9]\d*$/.test(String(runNumber).trim())) {
    throw new Error(`Invalid run number: ${runNumber}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}-beta.${runNumber}`;
};

const resolveStableVersion = (betaVersion) => {
  const match = BETA_VERSION.exec(String(betaVersion).trim());
  if (!match) {
    throw new Error(`Expected a beta version: ${betaVersion}`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
};

module.exports = {
  resolveBetaVersion,
  resolveStableVersion,
};
