import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { statfsSync } from 'node:fs';
import args from 'args';
import { getData, setData } from '@tradejs/infra/redis';
import { sendTelegramReport } from '../lib/telegramReports';
import type { TelegramReportAttachment } from '../lib/telegramReports';

type HealthIssueCode = 'load' | 'memory' | 'disk';

type HealthIssue = {
  code: HealthIssueCode;
  summary: string;
};

type DiskSnapshot = {
  path: string;
  usedPct: number | null;
};

type ServerHealthSnapshot = {
  hostname: string;
  timestamp: number;
  cpuCount: number;
  load1: number;
  load5: number;
  load15: number;
  loadPerCpu1: number;
  loadPerCpu5: number;
  memoryUsedPct: number;
  uptimeSec: number;
  disk: DiskSnapshot;
};

type ServerHealthState = {
  status: 'healthy' | 'alerting';
  lastAlertAt: number | null;
  lastOkAt: number | null;
  activeIssueCodes: HealthIssueCode[];
};

export type ServerHealthThresholds = {
  loadPerCpuWarn: number;
  loadPerCpuRecover: number;
  memoryWarnPct: number;
  memoryRecoverPct: number;
  diskWarnPct: number;
  diskRecoverPct: number;
};

type HealthEvaluation = {
  snapshot: ServerHealthSnapshot;
  issues: HealthIssue[];
  isHealthy: boolean;
};

const DEFAULT_STATE: ServerHealthState = {
  status: 'healthy',
  lastAlertAt: null,
  lastOkAt: null,
  activeIssueCodes: [],
};
const DEFAULT_THRESHOLDS: ServerHealthThresholds = {
  loadPerCpuWarn: 0.9,
  loadPerCpuRecover: 0.7,
  memoryWarnPct: 92,
  memoryRecoverPct: 88,
  diskWarnPct: 95,
  diskRecoverPct: 92,
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;
const formatPctValue = (value: number) => `${value.toFixed(1)}%`;

const formatDuration = (uptimeSec: number) => {
  const total = Math.max(0, Math.floor(uptimeSec));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
};

const readDiskUsage = (path: string): DiskSnapshot => {
  try {
    const stats = statfsSync(path);
    const totalBlocks = Number(stats.blocks ?? 0);
    const availableBlocks = Number(stats.bavail ?? 0);

    if (totalBlocks <= 0) {
      return { path, usedPct: null };
    }

    const usedPct =
      ((totalBlocks - Math.max(0, availableBlocks)) / totalBlocks) * 100;

    return {
      path,
      usedPct: Number.isFinite(usedPct) ? usedPct : null,
    };
  } catch {
    return { path, usedPct: null };
  }
};

const runDiagnosticCommand = (
  command: string,
  args: string[],
  fallbackLabel: string,
): string => {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    return output || `${fallbackLabel}: no output`;
  } catch (error) {
    return `${fallbackLabel}: ${String(error)}`;
  }
};

export const collectServerHealthSnapshot = (
  diskPath: string,
): ServerHealthSnapshot => {
  const [load1, load5, load15] = os.loadavg();
  const cpuCount = Math.max(1, os.cpus().length);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMemPct = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;

  return {
    hostname: os.hostname(),
    timestamp: Date.now(),
    cpuCount,
    load1,
    load5,
    load15,
    loadPerCpu1: load1 / cpuCount,
    loadPerCpu5: load5 / cpuCount,
    memoryUsedPct: usedMemPct,
    uptimeSec: os.uptime(),
    disk: readDiskUsage(diskPath),
  };
};

export const evaluateServerHealth = (
  snapshot: ServerHealthSnapshot,
  thresholds: ServerHealthThresholds,
): HealthEvaluation => {
  const issues: HealthIssue[] = [];

  if (snapshot.loadPerCpu1 >= thresholds.loadPerCpuWarn) {
    issues.push({
      code: 'load',
      summary: `CPU load high: 1m/core=${formatPercent(snapshot.loadPerCpu1)} (${snapshot.load1.toFixed(2)} on ${snapshot.cpuCount} cores), 5m/core=${formatPercent(snapshot.loadPerCpu5)}`,
    });
  }

  if (snapshot.memoryUsedPct >= thresholds.memoryWarnPct) {
    issues.push({
      code: 'memory',
      summary: `Memory high: used=${formatPctValue(snapshot.memoryUsedPct)}`,
    });
  }

  if (
    snapshot.disk.usedPct != null &&
    snapshot.disk.usedPct >= thresholds.diskWarnPct
  ) {
    issues.push({
      code: 'disk',
      summary: `Disk high: ${snapshot.disk.path} used=${formatPctValue(snapshot.disk.usedPct)}`,
    });
  }

  return {
    snapshot,
    issues,
    isHealthy: issues.length === 0,
  };
};

const shouldRecover = (
  snapshot: ServerHealthSnapshot,
  thresholds: ServerHealthThresholds,
) =>
  snapshot.loadPerCpu1 < thresholds.loadPerCpuRecover &&
  snapshot.memoryUsedPct < thresholds.memoryRecoverPct &&
  (snapshot.disk.usedPct == null ||
    snapshot.disk.usedPct < thresholds.diskRecoverPct);

const buildAlertMessage = ({
  evaluation,
  prevState,
  reminder,
}: {
  evaluation: HealthEvaluation;
  prevState: ServerHealthState;
  reminder: boolean;
}) => {
  const { snapshot, issues } = evaluation;
  const title = reminder
    ? '🚨 <b>TradeJS server still unhealthy</b>'
    : '🚨 <b>TradeJS server health alert</b>';

  return [
    title,
    '',
    `Host: <b>${escapeHtml(snapshot.hostname)}</b>`,
    `Time: <b>${escapeHtml(new Date(snapshot.timestamp).toISOString())}</b>`,
    `Uptime: <b>${escapeHtml(formatDuration(snapshot.uptimeSec))}</b>`,
    '',
    'Issues:',
    ...issues.map((issue) => `• ${escapeHtml(issue.summary)}`),
    '',
    'Snapshot:',
    `• CPU load: <b>${snapshot.load1.toFixed(2)} / ${snapshot.load5.toFixed(2)} / ${snapshot.load15.toFixed(2)}</b>`,
    `• Load per core: <b>${formatPercent(snapshot.loadPerCpu1)}</b> (1m), <b>${formatPercent(snapshot.loadPerCpu5)}</b> (5m)`,
    `• Memory used: <b>${escapeHtml(formatPctValue(snapshot.memoryUsedPct))}</b>`,
    `• Disk used: <b>${escapeHtml(
      snapshot.disk.usedPct == null
        ? `${snapshot.disk.path} n/a`
        : `${snapshot.disk.path} ${formatPctValue(snapshot.disk.usedPct)}`,
    )}</b>`,
    prevState.lastAlertAt
      ? `• Previous alert: <b>${escapeHtml(new Date(prevState.lastAlertAt).toISOString())}</b>`
      : '• Previous alert: <b>none</b>',
  ].join('\n');
};

const buildRecoveryMessage = ({
  snapshot,
  prevState,
}: {
  snapshot: ServerHealthSnapshot;
  prevState: ServerHealthState;
}) =>
  [
    '✅ <b>TradeJS server health recovered</b>',
    '',
    `Host: <b>${escapeHtml(snapshot.hostname)}</b>`,
    `Time: <b>${escapeHtml(new Date(snapshot.timestamp).toISOString())}</b>`,
    `Uptime: <b>${escapeHtml(formatDuration(snapshot.uptimeSec))}</b>`,
    '',
    'Snapshot:',
    `• CPU load: <b>${snapshot.load1.toFixed(2)} / ${snapshot.load5.toFixed(2)} / ${snapshot.load15.toFixed(2)}</b>`,
    `• Load per core: <b>${formatPercent(snapshot.loadPerCpu1)}</b> (1m), <b>${formatPercent(snapshot.loadPerCpu5)}</b> (5m)`,
    `• Memory used: <b>${escapeHtml(formatPctValue(snapshot.memoryUsedPct))}</b>`,
    `• Disk used: <b>${escapeHtml(
      snapshot.disk.usedPct == null
        ? `${snapshot.disk.path} n/a`
        : `${snapshot.disk.path} ${formatPctValue(snapshot.disk.usedPct)}`,
    )}</b>`,
    prevState.lastAlertAt
      ? `• Alert started: <b>${escapeHtml(new Date(prevState.lastAlertAt).toISOString())}</b>`
      : '• Alert started: <b>unknown</b>',
  ].join('\n');

export const buildServerHealthDiagnostics = ({
  snapshot,
  diskPath,
}: {
  snapshot: ServerHealthSnapshot;
  diskPath: string;
}) => {
  const topCpu = runDiagnosticCommand(
    'ps',
    ['axo', 'pid,ppid,%cpu,%mem,etime,state,comm,args', '--sort=-%cpu'],
    'ps cpu failed',
  );
  const topMemory = runDiagnosticCommand(
    'ps',
    ['axo', 'pid,ppid,%mem,%cpu,etime,state,comm,args', '--sort=-%mem'],
    'ps memory failed',
  );
  const freeMemory = runDiagnosticCommand('free', ['-m'], 'free failed');
  const diskUsage = runDiagnosticCommand('df', ['-h', diskPath], 'df failed');
  const uptimeText = runDiagnosticCommand('uptime', [], 'uptime failed');

  return [
    `TradeJS server health diagnostics`,
    `host: ${snapshot.hostname}`,
    `time: ${new Date(snapshot.timestamp).toISOString()}`,
    `uptime: ${formatDuration(snapshot.uptimeSec)}`,
    `load: ${snapshot.load1.toFixed(2)} / ${snapshot.load5.toFixed(2)} / ${snapshot.load15.toFixed(2)}`,
    `load_per_core: ${formatPercent(snapshot.loadPerCpu1)} (1m), ${formatPercent(snapshot.loadPerCpu5)} (5m)`,
    `memory_used: ${formatPctValue(snapshot.memoryUsedPct)}`,
    `disk_used: ${
      snapshot.disk.usedPct == null
        ? `${snapshot.disk.path} n/a`
        : `${snapshot.disk.path} ${formatPctValue(snapshot.disk.usedPct)}`
    }`,
    '',
    '=== uptime ===',
    uptimeText,
    '',
    '=== free -m ===',
    freeMemory,
    '',
    `=== df -h ${diskPath} ===`,
    diskUsage,
    '',
    '=== top processes by cpu ===',
    topCpu,
    '',
    '=== top processes by memory ===',
    topMemory,
    '',
  ].join('\n');
};

export const buildServerHealthAttachment = ({
  snapshot,
  diskPath,
}: {
  snapshot: ServerHealthSnapshot;
  diskPath: string;
}): TelegramReportAttachment => {
  const timestamp = new Date(snapshot.timestamp)
    .toISOString()
    .replace(/[:]/g, '-');

  return {
    filename: `server-health-${snapshot.hostname}-${timestamp}.txt`,
    content: buildServerHealthDiagnostics({ snapshot, diskPath }),
    caption: 'TradeJS server health diagnostics',
  };
};

const getStateKey = (userName: string, hostname: string) =>
  `ops:server-health:${userName}:${hostname}`;

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveServerHealthThresholds = (
  raw: Partial<Record<keyof ServerHealthThresholds, unknown>>,
): ServerHealthThresholds => {
  const loadPerCpuWarn = toFiniteNumber(raw.loadPerCpuWarn);
  const loadPerCpuRecover = toFiniteNumber(raw.loadPerCpuRecover);
  const memoryWarnPct = toFiniteNumber(raw.memoryWarnPct);
  const memoryRecoverPct = toFiniteNumber(raw.memoryRecoverPct);
  const diskWarnPct = toFiniteNumber(raw.diskWarnPct);
  const diskRecoverPct = toFiniteNumber(raw.diskRecoverPct);

  return {
    loadPerCpuWarn:
      loadPerCpuWarn != null && loadPerCpuWarn > 0
        ? loadPerCpuWarn
        : DEFAULT_THRESHOLDS.loadPerCpuWarn,
    loadPerCpuRecover:
      loadPerCpuRecover != null && loadPerCpuRecover > 0
        ? loadPerCpuRecover
        : DEFAULT_THRESHOLDS.loadPerCpuRecover,
    memoryWarnPct:
      memoryWarnPct != null && memoryWarnPct > 0
        ? memoryWarnPct
        : DEFAULT_THRESHOLDS.memoryWarnPct,
    memoryRecoverPct:
      memoryRecoverPct != null && memoryRecoverPct > 0
        ? memoryRecoverPct
        : DEFAULT_THRESHOLDS.memoryRecoverPct,
    diskWarnPct:
      diskWarnPct != null && diskWarnPct > 0
        ? diskWarnPct
        : DEFAULT_THRESHOLDS.diskWarnPct,
    diskRecoverPct:
      diskRecoverPct != null && diskRecoverPct > 0
        ? diskRecoverPct
        : DEFAULT_THRESHOLDS.diskRecoverPct,
  };
};

args.option(['u', 'user'], 'Use user config', 'root');
args.option(['P', 'printOnly'], 'Print report instead of Telegram', false);
args.option('diskPath', 'Filesystem path to inspect for disk pressure', '/');
args.option(
  'cooldownSec',
  'Minimum seconds between repeated unhealthy reminders',
  900,
);
args.option(
  'loadPerCpuWarn',
  'Alert when 1m load per CPU reaches this value',
  String(DEFAULT_THRESHOLDS.loadPerCpuWarn),
);
args.option(
  'loadPerCpuRecover',
  'Recovery threshold for 1m load per CPU',
  String(DEFAULT_THRESHOLDS.loadPerCpuRecover),
);
args.option(
  'memoryWarnPct',
  'Alert when memory used percent reaches this value',
  String(DEFAULT_THRESHOLDS.memoryWarnPct),
);
args.option(
  'memoryRecoverPct',
  'Recovery threshold for memory used percent',
  String(DEFAULT_THRESHOLDS.memoryRecoverPct),
);
args.option(
  'diskWarnPct',
  'Alert when disk used percent reaches this value',
  String(DEFAULT_THRESHOLDS.diskWarnPct),
);
args.option(
  'diskRecoverPct',
  'Recovery threshold for disk used percent',
  String(DEFAULT_THRESHOLDS.diskRecoverPct),
);

export const main = async () => {
  const flags = args.parse(process.argv);
  const thresholds = resolveServerHealthThresholds(flags);
  const diskPath = String(flags.diskPath || '/');
  const snapshot = collectServerHealthSnapshot(diskPath);
  const stateKey = getStateKey(String(flags.user), snapshot.hostname);
  const prevState = ((await getData(stateKey, DEFAULT_STATE)) ??
    DEFAULT_STATE) as ServerHealthState;
  const evaluation = evaluateServerHealth(snapshot, thresholds);
  const cooldownMs = Math.max(60, Number(flags.cooldownSec)) * 1_000;
  const now = snapshot.timestamp;

  if (!evaluation.isHealthy) {
    const reminder =
      prevState.status === 'alerting' &&
      typeof prevState.lastAlertAt === 'number' &&
      now - prevState.lastAlertAt < cooldownMs
        ? false
        : prevState.status === 'alerting';

    const shouldSend =
      prevState.status !== 'alerting' ||
      !prevState.lastAlertAt ||
      now - prevState.lastAlertAt >= cooldownMs;

    const nextState: ServerHealthState = {
      status: 'alerting',
      lastAlertAt: shouldSend ? now : prevState.lastAlertAt,
      lastOkAt: prevState.lastOkAt,
      activeIssueCodes: evaluation.issues.map((issue) => issue.code),
    };
    await setData(stateKey, nextState, { expire: 0 });

    if (shouldSend) {
      const message = buildAlertMessage({
        evaluation,
        prevState,
        reminder,
      });
      if (flags.printOnly) {
        console.log(message);
        console.log('');
        console.log(
          buildServerHealthDiagnostics({
            snapshot,
            diskPath,
          }),
        );
      } else {
        await sendTelegramReport(message, {
          userName: flags.user,
          attachments: [
            buildServerHealthAttachment({
              snapshot,
              diskPath,
            }),
          ],
        });
      }
    }
    return;
  }

  const recovered =
    prevState.status === 'alerting' && shouldRecover(snapshot, thresholds);
  const nextState: ServerHealthState = {
    status: 'healthy',
    lastAlertAt: prevState.lastAlertAt,
    lastOkAt: now,
    activeIssueCodes: [],
  };
  await setData(stateKey, nextState, { expire: 0 });

  if (recovered) {
    const message = buildRecoveryMessage({ snapshot, prevState });
    if (flags.printOnly) {
      console.log(message);
    } else {
      await sendTelegramReport(message, { userName: flags.user });
    }
  }
};
