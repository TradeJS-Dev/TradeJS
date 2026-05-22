import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { readFileSync, statfsSync } from 'node:fs';
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

type MemorySnapshot = {
  totalBytes: number;
  availableBytes: number;
  freeBytes: number;
  buffersBytes: number | null;
  cachedBytes: number | null;
  shmemBytes: number | null;
  slabBytes: number | null;
  reclaimableBytes: number | null;
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
  memory: MemorySnapshot;
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

const formatPctValue = (value: number) => `${value.toFixed(1)}%`;
const formatLoadPerCore = (value: number) => value.toFixed(2);
const formatGiB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

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

const parseMeminfoBytes = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const [amountRaw, unitRaw = 'kB'] = trimmed.split(/\s+/, 2);
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unit = unitRaw.toLowerCase();
  if (unit === 'kb') {
    return Math.round(amount * 1024);
  }
  if (unit === 'mb') {
    return Math.round(amount * 1024 ** 2);
  }
  if (unit === 'gb') {
    return Math.round(amount * 1024 ** 3);
  }
  return Math.round(amount);
};

const readMemorySnapshot = (): MemorySnapshot => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const values = new Map<string, number>();
    for (const line of meminfo.split('\n')) {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (!match) {
        continue;
      }
      const parsed = parseMeminfoBytes(match[2]);
      if (parsed != null) {
        values.set(match[1], parsed);
      }
    }

    return {
      totalBytes: values.get('MemTotal') ?? totalMem,
      availableBytes: values.get('MemAvailable') ?? freeMem,
      freeBytes: values.get('MemFree') ?? freeMem,
      buffersBytes: values.get('Buffers') ?? null,
      cachedBytes: values.get('Cached') ?? null,
      shmemBytes: values.get('Shmem') ?? null,
      slabBytes: values.get('Slab') ?? null,
      reclaimableBytes: values.get('SReclaimable') ?? null,
    };
  } catch {
    return {
      totalBytes: totalMem,
      availableBytes: freeMem,
      freeBytes: freeMem,
      buffersBytes: null,
      cachedBytes: null,
      shmemBytes: null,
      slabBytes: null,
      reclaimableBytes: null,
    };
  }
};

const runDiagnosticCommand = (command: string, args: string[]): string => {
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  return output || 'no output';
};

const runDiagnosticCommands = (
  commands: Array<{
    command: string;
    args: string[];
  }>,
  fallbackLabel: string,
): string => {
  const errors: string[] = [];

  for (const candidate of commands) {
    try {
      return runDiagnosticCommand(candidate.command, candidate.args);
    } catch (error) {
      errors.push(
        `${candidate.command} ${candidate.args.join(' ')} -> ${String(error)}`,
      );
    }
  }

  return `${fallbackLabel}: ${errors.join('\n')}`;
};

export const collectServerHealthSnapshot = (
  diskPath: string,
): ServerHealthSnapshot => {
  const [load1, load5, load15] = os.loadavg();
  const cpuCount = Math.max(1, os.cpus().length);
  const memory = readMemorySnapshot();
  const usedMemPct =
    memory.totalBytes > 0
      ? ((memory.totalBytes - memory.availableBytes) / memory.totalBytes) * 100
      : 0;

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
    memory,
    uptimeSec: os.uptime(),
    disk: readDiskUsage(diskPath),
  };
};

const buildHumanSummaryLines = (snapshot: ServerHealthSnapshot) => {
  const usedMem = Math.max(
    0,
    snapshot.memory.totalBytes - snapshot.memory.availableBytes,
  );

  return [
    `• vCPU: <b>${escapeHtml(formatPctValue(Math.min(100, snapshot.loadPerCpu1 * 100)))}</b>`,
    `• RAM: <b>${escapeHtml(formatPctValue(snapshot.memoryUsedPct))}</b> (${escapeHtml(
      `${formatGiB(usedMem)} / ${formatGiB(snapshot.memory.totalBytes)}`,
    )})`,
    `• Storage: <b>${escapeHtml(
      snapshot.disk.usedPct == null
        ? 'n/a'
        : formatPctValue(snapshot.disk.usedPct),
    )}</b>`,
  ];
};

export const evaluateServerHealth = (
  snapshot: ServerHealthSnapshot,
  thresholds: ServerHealthThresholds,
): HealthEvaluation => {
  const issues: HealthIssue[] = [];

  if (snapshot.loadPerCpu1 >= thresholds.loadPerCpuWarn) {
    issues.push({
      code: 'load',
      summary: `CPU load high: 1m/core=${formatLoadPerCore(
        snapshot.loadPerCpu1,
      )} (${snapshot.load1.toFixed(2)} on ${snapshot.cpuCount} cores), 5m/core=${formatLoadPerCore(snapshot.loadPerCpu5)}`,
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

export const buildAlertMessage = ({
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
    'Summary:',
    ...buildHumanSummaryLines(snapshot),
    '',
    'Issues:',
    ...issues.map((issue) => `• ${escapeHtml(issue.summary)}`),
    '',
    'Pressure:',
    `• Load avg: <b>${snapshot.load1.toFixed(2)} / ${snapshot.load5.toFixed(2)} / ${snapshot.load15.toFixed(2)}</b>`,
    `• Load per core: <b>${formatLoadPerCore(
      snapshot.loadPerCpu1,
    )}</b> (1m), <b>${formatLoadPerCore(snapshot.loadPerCpu5)}</b> (5m)`,
    prevState.lastAlertAt
      ? `• Previous alert: <b>${escapeHtml(new Date(prevState.lastAlertAt).toISOString())}</b>`
      : '• Previous alert: <b>none</b>',
  ].join('\n');
};

export const buildRecoveryMessage = ({
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
    'Summary:',
    ...buildHumanSummaryLines(snapshot),
    '',
    'Pressure:',
    `• Load avg: <b>${snapshot.load1.toFixed(2)} / ${snapshot.load5.toFixed(2)} / ${snapshot.load15.toFixed(2)}</b>`,
    `• Load per core: <b>${formatLoadPerCore(
      snapshot.loadPerCpu1,
    )}</b> (1m), <b>${formatLoadPerCore(snapshot.loadPerCpu5)}</b> (5m)`,
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
  const topCpu = runDiagnosticCommands(
    [
      {
        command: 'ps',
        args: [
          'axo',
          'pid,ppid,%cpu,%mem,etime,state,comm,args',
          '--sort=-%cpu',
        ],
      },
      {
        command: 'sh',
        args: [
          '-lc',
          'ps -o pid,ppid,%cpu,%mem,etime,state,comm,args | sort -k3 -nr | head -20',
        ],
      },
    ],
    'ps cpu failed',
  );
  const topMemory = runDiagnosticCommands(
    [
      {
        command: 'ps',
        args: [
          'axo',
          'pid,ppid,%mem,%cpu,etime,state,comm,args',
          '--sort=-%mem',
        ],
      },
      {
        command: 'sh',
        args: [
          '-lc',
          'ps -o pid,ppid,%mem,%cpu,etime,state,comm,args | sort -k3 -nr | head -20',
        ],
      },
    ],
    'ps memory failed',
  );
  const freeMemory = runDiagnosticCommands(
    [{ command: 'free', args: ['-m'] }],
    'free failed',
  );
  const diskUsage = runDiagnosticCommands(
    [{ command: 'df', args: ['-h', diskPath] }],
    'df failed',
  );
  const uptimeText = runDiagnosticCommands(
    [{ command: 'uptime', args: [] }],
    'uptime failed',
  );
  const memoryDetails = [
    `total: ${formatGiB(snapshot.memory.totalBytes)}`,
    `available: ${formatGiB(snapshot.memory.availableBytes)}`,
    `free: ${formatGiB(snapshot.memory.freeBytes)}`,
    snapshot.memory.buffersBytes == null
      ? null
      : `buffers: ${formatGiB(snapshot.memory.buffersBytes)}`,
    snapshot.memory.cachedBytes == null
      ? null
      : `cached: ${formatGiB(snapshot.memory.cachedBytes)}`,
    snapshot.memory.shmemBytes == null
      ? null
      : `shmem: ${formatGiB(snapshot.memory.shmemBytes)}`,
    snapshot.memory.reclaimableBytes == null
      ? null
      : `sreclaimable: ${formatGiB(snapshot.memory.reclaimableBytes)}`,
    snapshot.memory.slabBytes == null
      ? null
      : `slab: ${formatGiB(snapshot.memory.slabBytes)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `TradeJS server health diagnostics`,
    `host: ${snapshot.hostname}`,
    `time: ${new Date(snapshot.timestamp).toISOString()}`,
    `uptime: ${formatDuration(snapshot.uptimeSec)}`,
    `load: ${snapshot.load1.toFixed(2)} / ${snapshot.load5.toFixed(2)} / ${snapshot.load15.toFixed(2)}`,
    `load_per_core: ${formatLoadPerCore(snapshot.loadPerCpu1)} (1m), ${formatLoadPerCore(snapshot.loadPerCpu5)} (5m)`,
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
    '=== memory breakdown ===',
    memoryDetails,
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
