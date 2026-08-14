import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  Fragment,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import {
  Activity,
  Boxes,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Filter,
  Play,
  Power,
  RefreshCw,
  Server,
  Settings,
  Users,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { beginGoogleReauth } from '../lib/google-reauth';
import type {
  NetworkClusterPodsResult,
  NetworkDevice,
  NetworkDeviceHealth,
  NetworkHostAgentStatus,
  NetworkSamsungIssue,
  NetworkSamsungPrecheckSnapshot,
  NetworkVendorSettings,
  NetworkWrSubcloudControllerSettings,
  NetworkWrSubcloudSettings,
  SamsungPrecheckPhase,
  SamsungPrecheckRunState,
  SamsungAtlasOperation,
  SamsungPrecheckStatusValue,
  SubcloudPrecheckCheck,
  SubcloudPrecheckStatus,
} from '../types';

const REFRESH_MS = 12_000;
const PODS_REFRESH_MS = 30_000;
const ISSUES_REFRESH_MS = 30_000;
const SAMSUNG_PRECHECK_POLL_MS = 8_000;
const SAMSUNG_ATLAS_MAX_POLL_MS: Record<SamsungAtlasOperation, number> = {
  precheck: 20 * 60_000,
  upgrade: 3 * 60 * 60_000,
  rollback: 3 * 60 * 60_000,
  undeployment: 3 * 60 * 60_000,
  deployment: 3 * 60 * 60_000,
};
type NetworkTab = 'bmc' | 'subcloud' | 'pods' | 'issues';

type PodBulkAction =
  | 'show_pods'
  | 'hide_pods'
  | 'refresh'
  | 'connection_details'
  | 'setup_cluster'
  | 'samsung_precheck'
  | 'samsung_upgrade'
  | 'samsung_rollback'
  | 'samsung_undeployment'
  | 'samsung_deployment';

const POD_BULK_ACTIONS: {
  id: PodBulkAction;
  label: string;
  samsungOnly?: boolean;
  requiresMiddleware?: boolean;
}[] = [
  { id: 'show_pods', label: 'Show pods' },
  { id: 'hide_pods', label: 'Hide pods' },
  { id: 'refresh', label: 'Refresh pods' },
  { id: 'connection_details', label: 'Connection details', requiresMiddleware: true },
  { id: 'setup_cluster', label: 'Setup cluster', requiresMiddleware: true },
  { id: 'samsung_precheck', label: 'Samsung precheck', samsungOnly: true },
  { id: 'samsung_deployment', label: 'Samsung deployment', samsungOnly: true },
  { id: 'samsung_upgrade', label: 'Samsung upgrade', samsungOnly: true },
  { id: 'samsung_rollback', label: 'Samsung rollback', samsungOnly: true },
  { id: 'samsung_undeployment', label: 'Samsung undeployment', samsungOnly: true },
];

// Used until /network/settings answers; the backend is the source of truth and
// rejects anything outside its own list.
const FALLBACK_CIQ_SOURCES = ['MARKET_PLACE', 'CONQUEST_LAB'];

type PodHealthFilter = 'all' | 'healthy' | 'issues' | 'errors';
type PodAtlasStatusFilter = 'any' | 'none' | 'active' | 'success' | 'failed';

type PodDashboardFilters = {
  search: string;
  application: string;
  platform: string;
  parentController: string;
  podHealth: PodHealthFilter;
  atlasPrecheck: PodAtlasStatusFilter;
  atlasUpgrade: PodAtlasStatusFilter;
  atlasRollback: PodAtlasStatusFilter;
  atlasUndeployment: PodAtlasStatusFilter;
  atlasDeployment: PodAtlasStatusFilter;
};

const POD_FILTERS_STORAGE_KEY = 'network-pods-filters-v1';
const OWNER_FILTER_STORAGE_KEY = 'network-owner-filter-v1';
const SW_TAG_STORAGE_KEY = 'network-samsung-sw-tag-v1';

function loadStoredSwTag(): string {
  try {
    return sessionStorage.getItem(SW_TAG_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

const DEFAULT_POD_FILTERS: PodDashboardFilters = {
  search: '',
  application: '',
  platform: '',
  parentController: '',
  podHealth: 'all',
  atlasPrecheck: 'any',
  atlasUpgrade: 'any',
  atlasRollback: 'any',
  atlasUndeployment: 'any',
  atlasDeployment: 'any',
};

function loadOwnerFilter(): string {
  try {
    return sessionStorage.getItem(OWNER_FILTER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function loadPodFilters(): PodDashboardFilters {
  try {
    const raw = sessionStorage.getItem(POD_FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_POD_FILTERS };
    const parsed = JSON.parse(raw) as Partial<PodDashboardFilters>;
    return { ...DEFAULT_POD_FILTERS, ...parsed };
  } catch {
    return { ...DEFAULT_POD_FILTERS };
  }
}

function podFiltersActive(filters: PodDashboardFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.application !== '' ||
    filters.platform !== '' ||
    filters.parentController !== '' ||
    filters.podHealth !== 'all' ||
    filters.atlasPrecheck !== 'any' ||
    filters.atlasUpgrade !== 'any' ||
    filters.atlasRollback !== 'any' ||
    filters.atlasUndeployment !== 'any' ||
    filters.atlasDeployment !== 'any'
  );
}

function getPodRowForDevice(
  device: NetworkDevice,
  clusterPods: NetworkClusterPodsResult[]
): NetworkClusterPodsResult {
  return (
    clusterPods.find((c) => c.device_id === device.id) || {
      device_id: device.id,
      cluster_id: device.cluster_id,
      cluster_name: device.cluster_name,
      cluster_namespace: device.cluster_namespace || '',
      platform: device.os,
      total: 0,
      running: 0,
      not_running: 0,
      pods: [],
      fetched_at: '',
    }
  );
}

function getDeviceAtlasStatus(
  device: NetworkDevice,
  runs: Record<string, SamsungPrecheckRunState>,
  operation: SamsungAtlasOperation
): SamsungPrecheckStatusValue | null {
  const run = runs[device.id];
  if (run?.status) return run.status;
  const snap =
    operation === 'precheck'
      ? device.samsung_precheck_snapshot
      : operation === 'upgrade'
        ? device.samsung_upgrade_snapshot
          : operation === 'rollback'
            ? device.samsung_rollback_snapshot
            : operation === 'undeployment'
              ? device.samsung_undeployment_snapshot
              : device.samsung_deployment_snapshot;
  return snap?.status ?? null;
}

function atlasStatusMatchesFilter(
  status: SamsungPrecheckStatusValue | null,
  filter: PodAtlasStatusFilter
): boolean {
  if (filter === 'any') return true;
  if (filter === 'none') return status == null;
  if (filter === 'active') {
    return status === 'running' || status === 'pending' || status === 'unknown';
  }
  if (filter === 'success') return status === 'success';
  if (filter === 'failed') return status === 'failed' || status === 'cancelled';
  return true;
}

function deviceMatchesPodFilters(
  device: NetworkDevice,
  row: NetworkClusterPodsResult,
  filters: PodDashboardFilters,
  samsungPrecheckRuns: Record<string, SamsungPrecheckRunState>,
  samsungUpgradeRuns: Record<string, SamsungPrecheckRunState>,
  samsungRollbackRuns: Record<string, SamsungPrecheckRunState>,
  samsungUndeploymentRuns: Record<string, SamsungPrecheckRunState>,
  samsungDeploymentRuns: Record<string, SamsungPrecheckRunState>
): boolean {
  const q = filters.search.trim().toLowerCase();
  if (q) {
    const haystack = [
      device.cluster_id,
      device.cluster_name,
      device.cluster_namespace,
      device.fuze_site_id,
      device.owner,
      row.software_version,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (filters.application && (device.application || '') !== filters.application) return false;

  const platform = (row.platform || device.os || '').trim();
  if (filters.platform && platform !== filters.platform) return false;

  if (
    filters.parentController &&
    (device.parent_controller || '') !== filters.parentController
  ) {
    return false;
  }

  if (filters.podHealth !== 'all') {
    const hasError = Boolean(row.error);
    const hasIssue = hasError || row.not_running > 0;
    const allRunning = row.total > 0 && row.not_running === 0 && !hasError;
    if (filters.podHealth === 'errors' && !hasError) return false;
    if (filters.podHealth === 'issues' && !hasIssue) return false;
    if (filters.podHealth === 'healthy' && !(allRunning || (row.total === 0 && !hasError))) {
      return false;
    }
  }

  if (
    !atlasStatusMatchesFilter(
      getDeviceAtlasStatus(device, samsungPrecheckRuns, 'precheck'),
      filters.atlasPrecheck
    )
  ) {
    return false;
  }
  if (
    !atlasStatusMatchesFilter(
      getDeviceAtlasStatus(device, samsungUpgradeRuns, 'upgrade'),
      filters.atlasUpgrade
    )
  ) {
    return false;
  }
  if (
    !atlasStatusMatchesFilter(
      getDeviceAtlasStatus(device, samsungRollbackRuns, 'rollback'),
      filters.atlasRollback
    )
  ) {
    return false;
  }
  if (
    !atlasStatusMatchesFilter(
      getDeviceAtlasStatus(device, samsungUndeploymentRuns, 'undeployment'),
      filters.atlasUndeployment
    )
  ) {
    return false;
  }
  if (
    !atlasStatusMatchesFilter(
      getDeviceAtlasStatus(device, samsungDeploymentRuns, 'deployment'),
      filters.atlasDeployment
    )
  ) {
    return false;
  }

  return true;
}

type ConnectionDetailsState = {
  device_id: string;
  cluster_id: string;
  cluster_name: string;
  status: 'loading' | 'success' | 'failed';
  data?: unknown;
  url?: string;
  error?: string;
  fetched_at?: string;
  via?: string;
};

function flattenConnectionFields(value: unknown, prefix = ''): { key: string; value: string }[] {
  if (value == null) return [{ key: prefix || 'value', value: '—' }];
  if (typeof value !== 'object') return [{ key: prefix || 'value', value: String(value) }];
  if (Array.isArray(value)) {
    if (!value.length) return [{ key: prefix || 'items', value: '(empty)' }];
    return value.flatMap((item, i) =>
      flattenConnectionFields(item, prefix ? `${prefix}[${i}]` : `[${i}]`)
    );
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === 'object') return flattenConnectionFields(v, key);
    return [{ key, value: v == null ? '—' : String(v) }];
  });
}

function ConnectionDetailsPanel({ details }: { details: ConnectionDetailsState }) {
  const fields =
    details.status === 'success' && details.data != null
      ? flattenConnectionFields(details.data)
      : [];
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-gray-300">
            Connection details — {details.cluster_id}
          </p>
          <p className="mt-1 font-mono text-[11px] text-violet-300">{details.cluster_name}</p>
          {details.url && (
            <p className="mt-1 break-all font-mono text-[10px] text-gray-600">{details.url}</p>
          )}
        </div>
        <span
          className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${
            details.status === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : details.status === 'loading'
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
          }`}
        >
          {details.status === 'loading'
            ? 'Loading…'
            : details.status === 'success'
              ? 'Loaded'
              : 'Failed'}
        </span>
      </div>
      {details.error && <p className="mt-2 text-xs text-red-400">{details.error}</p>}
      {details.status === 'success' && fields.length > 0 && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(({ key, value }) => (
            <div key={key} className="flex gap-2">
              <dt className="shrink-0 font-mono text-gray-500">{key}</dt>
              <dd className="break-all font-mono text-gray-200">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {details.status === 'success' && fields.length === 0 && (
        <pre className="mt-3 overflow-x-auto rounded border border-white/5 bg-black/30 p-2 font-mono text-[11px] text-gray-300">
          {JSON.stringify(details.data, null, 2)}
        </pre>
      )}
      {details.fetched_at && (
        <p className="mt-2 text-[10px] text-gray-600">
          Fetched {formatProbed(details.fetched_at)}
          {details.via ? ` · via ${details.via}` : ''}
        </p>
      )}
    </div>
  );
}

const NETWORK_TABS: { id: NetworkTab; label: string }[] = [
  { id: 'bmc', label: 'BMC' },
  { id: 'subcloud', label: 'Subcloud' },
  { id: 'pods', label: 'Pods' },
  { id: 'issues', label: 'Issues' },
];

const ISSUE_OPERATION_FILTERS: { id: '' | SamsungAtlasOperation; label: string }[] = [
  { id: '', label: 'All operations' },
  { id: 'precheck', label: 'Precheck' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'upgrade', label: 'Upgrade' },
  { id: 'rollback', label: 'Rollback' },
  { id: 'undeployment', label: 'Undeployment' },
];

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatIssueDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

const VENDOR_CRED_FORMS = [
  {
    id: 'DELL',
    title: 'DELL Redfish credentials',
    hint: 'Shared for all DELL BMCs (iDRAC).',
  },
  {
    id: 'ZT',
    title: 'ZT Redfish credentials',
    hint: 'Shared for ZT Proteus BMCs.',
  },
  {
    id: 'HPE',
    title: 'HPE Redfish credentials',
    hint: 'Shared for HPE EL140 / iLO BMCs.',
  },
] as const;

type VendorCredId = (typeof VENDOR_CRED_FORMS)[number]['id'];

function isVendorConfigured(vendors: NetworkVendorSettings[], vendorId: string) {
  const row = vendors.find((v) => v.vendor.toUpperCase() === vendorId.toUpperCase());
  return Boolean(row?.password_set && row?.username);
}

function VendorCredForm({
  vendorId,
  title,
  hint,
  username,
  password,
  configured,
  saving,
  anySaving,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: {
  vendorId: VendorCredId;
  title: string;
  hint: string;
  username: string;
  password: string;
  configured: boolean;
  saving: boolean;
  anySaving: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="border-t border-white/5 pt-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs text-gray-500">
        {hint} Password is write-only on save.
        {!configured && (
          <span className="ml-1 text-amber-400">Not configured — Redfish health will fail.</span>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Username
          <input
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            className="w-48 rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
            autoComplete="username"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder={configured ? '••••••••' : ''}
            className="w-48 rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
            autoComplete="current-password"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={saving || anySaving || !username}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <input type="hidden" name="vendor" value={vendorId} />
    </form>
  );
}

function isGoogleTokenError(message: string | null | undefined) {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('google') ||
    m.includes('token') ||
    m.includes('oauth') ||
    m.includes('invalid_grant') ||
    m.includes('not configured') ||
    m.includes('workspace is not configured')
  );
}

function healthClass(health?: string) {
  const h = (health || '').toUpperCase();
  if (h === 'OK' || h === 'GOOD') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (h === 'WARNING') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (h === 'CRITICAL') return 'border-red-500/40 bg-red-500/10 text-red-300';
  if (!health) return 'border-surface-border bg-surface-overlay text-gray-500';
  return 'border-surface-border bg-surface-overlay text-gray-300';
}

function healthBadgeTitle(label: string, health?: string, detail?: string | null) {
  const status = health || '—';
  const extra = detail?.trim();
  return extra ? `${label}: ${status} — ${extra}` : `${label}: ${status}`;
}

function formatMemoryDetail(sizeGib?: number | null): string | null {
  if (sizeGib == null || Number.isNaN(sizeGib)) return null;
  return `${sizeGib} GiB`;
}

function systemHealthDetail(
  health: NetworkDeviceHealth,
  device: Pick<NetworkDevice, 'model' | 'model_type'>
): string | null {
  const fromRedfish = health.system?.model?.trim();
  if (fromRedfish) return fromRedfish;
  const sheet = [device.model, device.model_type].filter(Boolean).join(' · ');
  return sheet.trim() || null;
}

function processorHealthDetail(health: NetworkDeviceHealth): string | null {
  return health.processor?.model?.trim() || null;
}

function powerSupplyHealthDetail(health: NetworkDeviceHealth): string | null {
  const psu = health.power_supply;
  if (!psu) return null;
  const lines = (psu.supplies || [])
    .map((s) => {
      const parts = [s.name || 'PSU', s.health || '—'];
      if (s.state) parts.push(`(${s.state})`);
      if (s.watts != null) parts.push(`${s.watts}W`);
      return parts.join(' · ');
    })
    .filter(Boolean);
  if (lines.length) return lines.join('\n');
  if (psu.count != null && psu.count > 0) {
    return `${psu.ok_count ?? 0}/${psu.count} supply(ies) OK`;
  }
  return null;
}

type HostPowerKind = 'on' | 'off' | 'transition' | 'unknown';

function hostPowerKind(power?: string | null): HostPowerKind {
  const p = (power || '').toLowerCase();
  if (p === 'on') return 'on';
  if (p === 'off') return 'off';
  if (p.includes('powering') || p === 'paused') return 'transition';
  return 'unknown';
}

function hostPowerLabel(power?: string | null, redfishOk?: boolean): string {
  if (!redfishOk) return '—';
  const raw = power?.trim();
  if (!raw) return 'Unknown';
  if (raw.toLowerCase() === 'on') return 'On';
  if (raw.toLowerCase() === 'off') return 'Off';
  return raw;
}

function hostPowerClass(kind: HostPowerKind, hasData: boolean) {
  if (!hasData) return 'border-surface-border bg-surface-overlay text-gray-500';
  if (kind === 'on') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (kind === 'off') return 'border-red-500/40 bg-red-500/10 text-red-300';
  if (kind === 'transition') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return 'border-surface-border bg-surface-overlay text-gray-400';
}

function HostPowerBadge({
  power,
  redfishOk,
}: {
  power?: string | null;
  redfishOk?: boolean;
}) {
  const hasData = Boolean(redfishOk && power?.trim());
  const kind = hostPowerKind(power);
  const label = hostPowerLabel(power, redfishOk);
  const title = hasData
    ? `Host power: ${power} (Redfish PowerState)`
    : redfishOk
      ? 'Host power: unknown'
      : 'Host power requires Redfish OK';

  return (
    <span
      className={`inline-flex w-fit cursor-default items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${hostPowerClass(kind, hasData)}`}
      title={title}
    >
      <span className="text-gray-500">Host</span>
      {label}
    </span>
  );
}

function bmcSessionsLabel(sessions?: NetworkDeviceHealth['sessions']): string {
  if (sessions?.count == null) return '—';
  if (sessions.max != null) return `${sessions.count}/${sessions.max}`;
  return String(sessions.count);
}

function bmcSessionsDetail(sessions?: NetworkDeviceHealth['sessions']): string {
  if (sessions?.count == null) return 'Active BMC user sessions (Redfish SessionService)';
  let base = `${sessions.count} active session${sessions.count === 1 ? '' : 's'}`;
  if (sessions.max != null) base += ` (max ${sessions.max})`;
  const users = sessions.users?.filter(Boolean);
  if (users?.length) return `${base}\nUsers: ${users.join(', ')}`;
  return base;
}

function bmcSessionsClass(
  sessions: NetworkDeviceHealth['sessions'] | undefined,
  hasData: boolean
): string {
  if (!hasData) return 'border-surface-border bg-surface-overlay text-gray-500';
  const count = sessions?.count ?? 0;
  const max = sessions?.max;
  if (max != null && count >= max) {
    return 'border-red-500/40 bg-red-500/10 text-red-300';
  }
  if (max != null && count >= Math.max(1, Math.floor(max * 0.8))) {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
  if (count > 0) return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
  return 'border-surface-border bg-surface-overlay text-gray-400';
}

function BmcSessionsBadge({
  sessions,
  redfishOk,
}: {
  sessions?: NetworkDeviceHealth['sessions'];
  redfishOk?: boolean;
}) {
  const hasData = Boolean(redfishOk && sessions?.count != null);
  const label = bmcSessionsLabel(sessions);
  const title = redfishOk
    ? bmcSessionsDetail(sessions)
    : 'BMC sessions require Redfish OK';

  return (
    <span
      className={`inline-flex w-fit cursor-default items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${bmcSessionsClass(sessions, hasData)}`}
      title={title}
    >
      <Users className="h-3 w-3 shrink-0 opacity-70" />
      {label}
    </span>
  );
}

function HealthBadge({
  label,
  health,
  detail,
}: {
  label: string;
  health?: string;
  detail?: string | null;
}) {
  return (
    <span
      className={`inline-flex cursor-default items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${healthClass(health)}`}
      title={healthBadgeTitle(label, health, detail)}
    >
      <span className="text-gray-500">{label}</span>
      {health || '—'}
    </span>
  );
}

function formatProbed(iso: string | undefined) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

/** Date + time for Atlas run timestamps so operators can tell if a status is current. */
function formatAtlasRunAt(iso: string | null | undefined) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function precheckStatusClass(status?: SubcloudPrecheckStatus | null) {
  if (status === 'pass') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'warn') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (status === 'fail') return 'border-red-500/40 bg-red-500/10 text-red-300';
  return 'border-surface-border bg-surface-overlay text-gray-500';
}

function precheckStatusLabel(status?: SubcloudPrecheckStatus | null) {
  if (status === 'pass') return 'Pass';
  if (status === 'warn') return 'Warn';
  if (status === 'fail') return 'Fail';
  return '—';
}

function podPhaseClass(phase?: string) {
  const p = (phase || '').toLowerCase();
  if (p === 'running') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (p === 'pending') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (p === 'succeeded') return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
  if (p === 'failed' || p === 'unknown') return 'border-red-500/40 bg-red-500/10 text-red-300';
  return 'border-surface-border bg-surface-overlay text-gray-400';
}

function isSamsungRunActive(run: SamsungPrecheckRunState): boolean {
  if (run.status === 'cancelled') return false;
  if (run.status === 'running' || run.status === 'pending' || run.status === 'unknown') return true;
  if (run.phase === 'monitoring' || run.phase === 'queued' || run.phase === 'running') {
    return run.status !== 'success' && run.status !== 'failed';
  }
  return false;
}

function samsungRunFreshness(run: { updated_at?: string; launched_at?: string }): number {
  return new Date(run.updated_at || run.launched_at || 0).getTime();
}

function shouldHydrateFromSnapshot(
  existing: SamsungPrecheckRunState | undefined,
  snap: NetworkSamsungPrecheckSnapshot
): boolean {
  if (!existing) return true;
  if (isSamsungRunActive(existing)) return false;
  // Keep a local cancel sticky unless the server snapshot is also cancelled
  // (or a newer launch replaced it).
  if (existing.status === 'cancelled' && snap.status !== 'cancelled') {
    const sameLaunch =
      existing.launched_at &&
      snap.launched_at &&
      String(existing.launched_at) === String(snap.launched_at);
    if (sameLaunch) return false;
  }

  const existingTs = samsungRunFreshness(existing);
  const snapTs = samsungRunFreshness(snap);
  if (existingTs > snapTs) return false;

  const existingTerminal =
    existing.status === 'success' ||
    existing.status === 'failed' ||
    existing.status === 'cancelled';
  const snapTerminal =
    snap.status === 'success' || snap.status === 'failed' || snap.status === 'cancelled';
  if (existingTerminal && !snapTerminal) return false;

  return true;
}

function samsungSnapshotToRunState(
  device: NetworkDevice,
  snap: NetworkSamsungPrecheckSnapshot,
  operation: SamsungAtlasOperation
): SamsungPrecheckRunState {
  return {
    device_id: device.id,
    cluster_id: device.cluster_id,
    operation,
    version: snap.version,
    ciq_source: snap.ciq_source ?? null,
    workload: snap.workload,
    template_id: snap.template_id,
    job_id: snap.launcher_job_id ?? null,
    job_kind: snap.job_kind ?? null,
    launcher_job_id: snap.launcher_job_id ?? null,
    monitor_job_id: snap.monitor_job_id ?? null,
    monitor_job_kind: snap.monitor_job_kind ?? null,
    phase: snap.phase,
    status: snap.status,
    message: snap.message,
    job: snap.job,
    launcher_job: snap.launcher_job ?? null,
    activity: snap.activity,
    launched_at: snap.launched_at,
    updated_at: snap.updated_at,
    error: snap.error ?? null,
    cancelled_at: snap.cancelled_at ?? null,
    cancelled_reason: snap.cancelled_reason ?? null,
  };
}

function samsungAtlasLabels(operation: SamsungAtlasOperation) {
  if (operation === 'upgrade') {
    return { title: 'Samsung Atlas upgrade', jobLabel: 'upgrade', targetLabel: 'target' };
  }
  if (operation === 'rollback') {
    return { title: 'Samsung Atlas rollback', jobLabel: 'rollback', targetLabel: 'rollback' };
  }
  if (operation === 'undeployment') {
    return {
      title: 'Samsung Atlas undeployment',
      jobLabel: 'undeployment',
      targetLabel: 'current',
    };
  }
  if (operation === 'deployment') {
    return {
      title: 'Samsung Atlas deployment',
      jobLabel: 'deployment',
      targetLabel: 'target',
    };
  }
  return { title: 'Samsung Atlas precheck', jobLabel: 'precheck', targetLabel: 'target' };
}

function hydrateSamsungAtlasRuns(
  devices: NetworkDevice[],
  prev: Record<string, SamsungPrecheckRunState>,
  snapshotKey:
    | 'samsung_precheck_snapshot'
    | 'samsung_upgrade_snapshot'
    | 'samsung_rollback_snapshot'
    | 'samsung_undeployment_snapshot'
    | 'samsung_deployment_snapshot',
  operation: SamsungAtlasOperation
): Record<string, SamsungPrecheckRunState> {
  const next = { ...prev };
  for (const device of devices) {
    const snap = device[snapshotKey];
    if (!snap) continue;
    const existing = prev[device.id];
    if (!shouldHydrateFromSnapshot(existing, snap)) continue;
    next[device.id] = samsungSnapshotToRunState(device, snap, operation);
  }
  return next;
}

function hydrateSamsungPrecheckRuns(
  devices: NetworkDevice[],
  prev: Record<string, SamsungPrecheckRunState>
) {
  return hydrateSamsungAtlasRuns(devices, prev, 'samsung_precheck_snapshot', 'precheck');
}

function hydrateSamsungUpgradeRuns(
  devices: NetworkDevice[],
  prev: Record<string, SamsungPrecheckRunState>
) {
  return hydrateSamsungAtlasRuns(devices, prev, 'samsung_upgrade_snapshot', 'upgrade');
}

function hydrateSamsungRollbackRuns(
  devices: NetworkDevice[],
  prev: Record<string, SamsungPrecheckRunState>
) {
  return hydrateSamsungAtlasRuns(devices, prev, 'samsung_rollback_snapshot', 'rollback');
}

function hydrateSamsungUndeploymentRuns(
  devices: NetworkDevice[],
  prev: Record<string, SamsungPrecheckRunState>
) {
  return hydrateSamsungAtlasRuns(devices, prev, 'samsung_undeployment_snapshot', 'undeployment');
}

function hydrateSamsungDeploymentRuns(
  devices: NetworkDevice[],
  prev: Record<string, SamsungPrecheckRunState>
) {
  return hydrateSamsungAtlasRuns(devices, prev, 'samsung_deployment_snapshot', 'deployment');
}

function canCancelSamsungAtlasRun(run: SamsungPrecheckRunState | undefined, operation: SamsungAtlasOperation) {
  if (!run || operation === 'precheck') return false;
  return run.status !== 'cancelled';
}

function samsungPrecheckStatusClass(status?: SamsungPrecheckStatusValue | null) {
  if (status === 'success') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'failed') return 'border-red-500/40 bg-red-500/10 text-red-300';
  if (status === 'cancelled') return 'border-gray-500/40 bg-gray-500/10 text-gray-400';
  if (status === 'running') return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  if (status === 'pending') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return 'border-surface-border bg-surface-overlay text-gray-500';
}

function samsungPrecheckStatusLabel(status?: SamsungPrecheckStatusValue | null, phase?: SamsungPrecheckPhase) {
  if (status === 'success') return 'Success';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'running') return 'Running';
  if (status === 'pending' && phase === 'monitoring') return 'Waiting';
  if (status === 'pending') return 'Queued';
  return '—';
}

function SamsungAtlasPanel({
  run,
  operation,
  onCancel,
  cancelBusy,
}: {
  run: SamsungPrecheckRunState;
  operation: SamsungAtlasOperation;
  onCancel?: () => void;
  cancelBusy?: boolean;
}) {
  const { title, jobLabel, targetLabel } = samsungAtlasLabels(operation);
  const showCancel = canCancelSamsungAtlasRun(run, operation);
  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-gray-300">
            {title} — {run.cluster_id}
          </p>
          <p className="mt-1 text-[11px] text-gray-500">
            {run.workload} · template {run.template_id} · {targetLabel} {run.version}
            {run.ciq_source ? ` · CIQ ${run.ciq_source}` : ''}
            {run.launcher_job_id ? ` · launcher #${run.launcher_job_id}` : ''}
            {run.monitor_job_id ? ` · ${jobLabel} #${run.monitor_job_id}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showCancel && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelBusy}
              title="Stop dashboard monitoring only — does not cancel Atlas or MP jobs"
              className="inline-flex items-center gap-1 rounded border border-gray-500/40 bg-gray-500/10 px-2 py-0.5 text-[11px] font-medium text-gray-300 transition-colors hover:bg-gray-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <XCircle className={`h-3 w-3 ${cancelBusy ? 'animate-pulse' : ''}`} />
              {cancelBusy ? 'Cancelling…' : 'Cancel monitoring'}
            </button>
          )}
          <span
            className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${samsungPrecheckStatusClass(run.status)}`}
          >
            {samsungPrecheckStatusLabel(run.status, run.phase)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-200">{run.message}</p>
      {run.status === 'cancelled' && (
        <p className="mt-1 text-[11px] text-gray-500">
          Dashboard monitoring stopped
          {run.cancelled_reason ? `: ${run.cancelled_reason}` : ''}
          {run.cancelled_at ? ` · ${formatAtlasRunAt(run.cancelled_at)}` : ''}
        </p>
      )}
      {run.error && <p className="mt-1 text-xs text-red-400">{run.error}</p>}
      {run.job && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {run.job.raw_status && (
            <>
              <dt className="text-gray-500">Job status</dt>
              <dd className="font-mono text-gray-200">{run.job.raw_status}</dd>
            </>
          )}
          {run.job.started && (
            <>
              <dt className="text-gray-500">Started</dt>
              <dd className="text-gray-300">{formatAtlasRunAt(run.job.started)}</dd>
            </>
          )}
          {run.job.finished && (
            <>
              <dt className="text-gray-500">Finished</dt>
              <dd className="text-gray-300">{formatAtlasRunAt(run.job.finished)}</dd>
            </>
          )}
          {run.job.elapsed != null && (
            <>
              <dt className="text-gray-500">Elapsed</dt>
              <dd className="text-gray-300">{run.job.elapsed}s</dd>
            </>
          )}
        </dl>
      )}
      {run.error_report?.detail && (
        <div className="mt-2 space-y-1 rounded border border-red-500/30 bg-red-500/10 p-2">
          <p className="text-[11px] font-medium text-red-200">
            Root cause
            {run.error_report.job_id ? (
              <span className="ml-1 font-mono text-[10px] text-red-300/80">
                · job #{run.error_report.job_id}
                {run.error_report.name ? ` · ${run.error_report.name}` : ''}
              </span>
            ) : null}
          </p>
          <p className="whitespace-pre-wrap break-words text-xs text-red-100">
            {run.error_report.detail}
          </p>
          {run.error_report.analysis?.remediation && (
            <p className="text-[11px] text-amber-100/90">
              {run.error_report.analysis.provider === 'issues'
                ? 'Known fix (Issues tab)'
                : 'Next step'}
              {run.error_report.analysis.provider === 'issues' &&
              run.error_report.analysis.matched_cluster_id
                ? ` · prior ${run.error_report.analysis.matched_cluster_id}`
                : ''}
              : {run.error_report.analysis.remediation}
            </p>
          )}
          {run.error_report.raw_detail &&
            run.error_report.raw_detail !== run.error_report.detail && (
              <pre className="max-h-24 overflow-auto font-mono text-[10px] text-red-300/70">
                {run.error_report.raw_detail}
              </pre>
            )}
        </div>
      )}
      {!run.error_report?.detail && run.job?.job_explanation && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] text-red-300/90">
          {run.job.job_explanation}
        </pre>
      )}
      {run.activity.recent.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-600">
            Activity stream
          </p>
          <ul className="mt-1 space-y-1">
            {run.activity.recent.map((entry) => (
              <li
                key={`${entry.id}-${entry.timestamp}`}
                className="rounded border border-white/5 bg-surface-overlay/40 px-2 py-1.5 text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {entry.timestamp && (
                    <span className="text-gray-500">{formatAtlasRunAt(entry.timestamp)}</span>
                  )}
                  {entry.status && (
                    <span
                      className={`rounded border px-1 py-0.5 text-[10px] ${samsungPrecheckStatusClass(entry.status as SamsungPrecheckStatusValue)}`}
                    >
                      {entry.status}
                    </span>
                  )}
                </div>
                {entry.summary && <p className="mt-0.5 text-gray-300">{entry.summary}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {run.activity.error && (
        <p className="mt-2 text-xs text-amber-400/90">Activity stream: {run.activity.error}</p>
      )}
      <p className="mt-2 text-[10px] text-gray-600">
        Launched {formatAtlasRunAt(run.launched_at)}
        {(run.status === 'success' || run.status === 'failed') && run.updated_at !== run.launched_at
          ? ` · finished ${formatAtlasRunAt(run.updated_at)}`
          : ''}
        {run.status === 'running' || run.status === 'pending' || run.phase === 'monitoring'
          ? ` · auto-refresh every ${SAMSUNG_PRECHECK_POLL_MS / 1000}s`
          : run.status === 'cancelled'
            ? ' · monitoring stopped'
            : ''}
      </p>
    </div>
  );
}

function SamsungAtlasStatusCell({
  run,
  busy,
  operation,
  onToggle,
}: {
  run?: SamsungPrecheckRunState;
  busy: boolean;
  operation: SamsungAtlasOperation;
  onToggle: () => void;
}) {
  if (!run && !busy) {
    return <span className="text-[11px] text-gray-600">—</span>;
  }
  const { jobLabel } = samsungAtlasLabels(operation);
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-left"
      title={run?.message || `Samsung ${operation} in progress`}
    >
      <span
        className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${samsungPrecheckStatusClass(run?.status || (busy ? 'pending' : 'unknown'))}`}
      >
        {busy ? 'Launching…' : samsungPrecheckStatusLabel(run?.status, run?.phase)}
      </span>
      {run?.monitor_job_id ? (
        <p className="mt-0.5 font-mono text-[10px] text-gray-500">
          {jobLabel} #{run.monitor_job_id}
        </p>
      ) : run?.launcher_job_id ? (
        <p className="mt-0.5 font-mono text-[10px] text-gray-500">
          launcher #{run.launcher_job_id}
        </p>
      ) : null}
      {run &&
        !isSamsungRunActive(run) &&
        (run.status === 'success' || run.status === 'failed') && (
          <p className="mt-0.5 text-[10px] text-gray-500">
            Last run {formatAtlasRunAt(run.updated_at)}
          </p>
        )}
    </button>
  );
}

function formatPodAge(iso: string | null | undefined) {
  if (!iso) return '—';
  const started = new Date(iso);
  if (Number.isNaN(started.getTime())) return '—';
  const sec = Math.floor((Date.now() - started.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function PrecheckBadge({ status }: { status?: SubcloudPrecheckStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex w-fit rounded border border-surface-border px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
        Not run
      </span>
    );
  }
  return (
    <span
      className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[11px] font-medium ${precheckStatusClass(status)}`}
    >
      {precheckStatusLabel(status)}
    </span>
  );
}

function PrecheckCheckRow({ check }: { check: SubcloudPrecheckCheck }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 py-1.5 last:border-0">
      <span className="text-xs text-gray-300">{check.label}</span>
      <div className="flex items-center gap-2 text-right">
        {check.detail && (
          <span className="max-w-[280px] truncate text-[11px] text-gray-500" title={check.detail}>
            {check.detail}
          </span>
        )}
        <PrecheckBadge status={check.status} />
      </div>
    </div>
  );
}

/** HTTPS host for BMC UI — IPv6 must be bracketed. */
function bmcHostForUrl(ip: string): string {
  const trimmed = ip.trim();
  if (!trimmed) return '';
  if (trimmed.includes(':') && !trimmed.startsWith('[')) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

function bmcConsoleLabel(vendor?: string | null): string {
  const v = (vendor || '').toUpperCase();
  if (v.includes('HPE') || v.includes('HP') || v.includes('ILO')) return 'iLO';
  if (v.includes('DELL') || v.includes('IDRAC')) return 'iDRAC';
  if (v.includes('ZT')) return 'BMC';
  return 'BMC';
}

/** Open Dell iDRAC / HPE iLO web UI in a new tab. */
function bmcConsoleUrl(ip: string): string | null {
  const host = bmcHostForUrl(ip);
  if (!host) return null;
  return `https://${host}/`;
}

function OwnerFilterBar({
  value,
  options,
  onChange,
  visibleCount,
  totalCount,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  visibleCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
      <label className="flex min-w-[180px] flex-col gap-1 text-xs text-gray-400">
        Owner
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
        >
          <option value="">All owners</option>
          {options.map((owner) => (
            <option key={owner} value={owner}>
              {owner}
            </option>
          ))}
        </select>
      </label>
      {value ? (
        <span className="pb-1.5 text-xs text-gray-500">
          Showing {visibleCount} of {totalCount} site{totalCount === 1 ? '' : 's'}
        </span>
      ) : (
        <span className="pb-1.5 text-xs text-gray-600">
          Filter by vDU_List Owner to focus on your sites
        </span>
      )}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="mb-0.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:text-gray-200"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function BmcIpLink({ ip, vendor }: { ip: string; vendor?: string | null }) {
  const url = bmcConsoleUrl(ip);
  const label = bmcConsoleLabel(vendor);
  if (!url) {
    return <span className="font-mono text-xs text-gray-500">—</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${label} console (${url})`}
      className="group inline-flex max-w-full items-center gap-1 font-mono text-xs text-sky-300 transition-colors hover:text-sky-200 hover:underline"
    >
      <span className="truncate">{ip}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100" />
      <span className="sr-only">Open {label}</span>
    </a>
  );
}

export function NetworkPage({
  refreshToken = 0,
  canWrite = true,
}: {
  refreshToken?: number;
  canWrite?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<NetworkTab>('bmc');
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [sheetId, setSheetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [vendors, setVendors] = useState<NetworkVendorSettings[]>([]);
  const [wrSubcloud, setWrSubcloud] = useState<NetworkWrSubcloudSettings>({
    username: '',
    password_set: false,
    key_path_set: false,
    configured: false,
  });
  const [wrControllers, setWrControllers] = useState<NetworkWrSubcloudControllerSettings[]>([]);
  const [wrControllerUsers, setWrControllerUsers] = useState<Record<string, string>>({});
  const [wrControllerPasses, setWrControllerPasses] = useState<Record<string, string>>({});
  const [savingWrController, setSavingWrController] = useState<string | null>(null);
  const [wrSshUser, setWrSshUser] = useState('');
  const [wrSshPass, setWrSshPass] = useState('');
  const [savingWrSsh, setSavingWrSsh] = useState(false);
  const [precheckCustomCommands, setPrecheckCustomCommands] = useState('');
  const [precheckLogDir, setPrecheckLogDir] = useState('logs/subcloud-precheck');
  const [savingPrecheckCustom, setSavingPrecheckCustom] = useState(false);
  const [credUsers, setCredUsers] = useState<Record<VendorCredId, string>>({
    DELL: '',
    ZT: '',
    HPE: '',
  });
  const [credPasses, setCredPasses] = useState<Record<VendorCredId, string>>({
    DELL: '',
    ZT: '',
    HPE: '',
  });
  const [savingCreds, setSavingCreds] = useState<VendorCredId | null>(null);
  const [credsMsg, setCredsMsg] = useState<string | null>(null);
  const [googleOk, setGoogleOk] = useState<boolean | null>(null);
  const [googleAccount, setGoogleAccount] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [rebootingId, setRebootingId] = useState<string | null>(null);
  const [bmcResettingId, setBmcResettingId] = useState<string | null>(null);
  const [precheckingId, setPrecheckingId] = useState<string | null>(null);
  const [expandedPrecheckId, setExpandedPrecheckId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [hostAgent, setHostAgent] = useState<NetworkHostAgentStatus | null>(null);
  const [clusterPods, setClusterPods] = useState<NetworkClusterPodsResult[]>([]);
  const [podsLoading, setPodsLoading] = useState(false);
  const [podsError, setPodsError] = useState<string | null>(null);
  const [podsFetchedAt, setPodsFetchedAt] = useState<string | null>(null);
  const [expandedPodClusterIds, setExpandedPodClusterIds] = useState<Set<string>>(new Set());
  const [refreshingPodIds, setRefreshingPodIds] = useState<Set<string>>(new Set());
  const [selectedPodDeviceIds, setSelectedPodDeviceIds] = useState<Set<string>>(new Set());
  const [podBulkAction, setPodBulkAction] = useState<PodBulkAction>('refresh');
  const [podBulkRunning, setPodBulkRunning] = useState(false);
  const [samsungPrecheckingId, setSamsungPrecheckingId] = useState<string | null>(null);
  const [samsungUpgradingId, setSamsungUpgradingId] = useState<string | null>(null);
  const [samsungRollbackingId, setSamsungRollbackingId] = useState<string | null>(null);
  const [samsungUndeployingId, setSamsungUndeployingId] = useState<string | null>(null);
  const [samsungDeployingId, setSamsungDeployingId] = useState<string | null>(null);
  const [samsungCancellingId, setSamsungCancellingId] = useState<string | null>(null);
  const [atlasConfigured, setAtlasConfigured] = useState(false);
  const [atlasBearerSet, setAtlasBearerSet] = useState(false);
  const [atlasBearerInput, setAtlasBearerInput] = useState('');
  const [savingAtlasBearer, setSavingAtlasBearer] = useState(false);
  const [ciqSources, setCiqSources] = useState<string[]>(FALLBACK_CIQ_SOURCES);
  const [ciqSource, setCiqSource] = useState<string>(FALLBACK_CIQ_SOURCES[0]);
  const [swTags, setSwTags] = useState<string[]>([]);
  const [selectedSwTag, setSelectedSwTag] = useState(() => loadStoredSwTag());
  const [middlewareConfigured, setMiddlewareConfigured] = useState(false);
  const [connectionDetailsByDevice, setConnectionDetailsByDevice] = useState<
    Record<string, ConnectionDetailsState>
  >({});
  const [expandedConnectionDetailsIds, setExpandedConnectionDetailsIds] = useState<Set<string>>(
    new Set()
  );
  const [samsungPrecheckRuns, setSamsungPrecheckRuns] = useState<
    Record<string, SamsungPrecheckRunState>
  >({});
  const [samsungUpgradeRuns, setSamsungUpgradeRuns] = useState<
    Record<string, SamsungPrecheckRunState>
  >({});
  const [samsungRollbackRuns, setSamsungRollbackRuns] = useState<
    Record<string, SamsungPrecheckRunState>
  >({});
  const [samsungUndeploymentRuns, setSamsungUndeploymentRuns] = useState<
    Record<string, SamsungPrecheckRunState>
  >({});
  const [samsungDeploymentRuns, setSamsungDeploymentRuns] = useState<
    Record<string, SamsungPrecheckRunState>
  >({});
  const [expandedSamsungPrecheckId, setExpandedSamsungPrecheckId] = useState<string | null>(null);
  const [expandedSamsungUpgradeId, setExpandedSamsungUpgradeId] = useState<string | null>(null);
  const [expandedSamsungRollbackId, setExpandedSamsungRollbackId] = useState<string | null>(null);
  const [expandedSamsungUndeploymentId, setExpandedSamsungUndeploymentId] = useState<string | null>(
    null
  );
  const [expandedSamsungDeploymentId, setExpandedSamsungDeploymentId] = useState<string | null>(
    null
  );
  const [podFilters, setPodFilters] = useState<PodDashboardFilters>(() => loadPodFilters());
  const [podFiltersOpen, setPodFiltersOpen] = useState(() => podFiltersActive(loadPodFilters()));
  const [ownerFilter, setOwnerFilter] = useState(() => loadOwnerFilter());
  const [samsungIssues, setSamsungIssues] = useState<NetworkSamsungIssue[]>([]);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issuesSearch, setIssuesSearch] = useState('');
  const [issuesQuery, setIssuesQuery] = useState('');
  const [issuesOperation, setIssuesOperation] = useState<'' | SamsungAtlasOperation>('');
  const [issuesOpenOnly, setIssuesOpenOnly] = useState(false);
  const [issuesDrafts, setIssuesDrafts] = useState<
    Record<string, { resolved_date: string; resolution_details: string }>
  >({});
  const [issuesSavingId, setIssuesSavingId] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem(POD_FILTERS_STORAGE_KEY, JSON.stringify(podFilters));
  }, [podFilters]);

  useEffect(() => {
    sessionStorage.setItem(OWNER_FILTER_STORAGE_KEY, ownerFilter);
  }, [ownerFilter]);

  useEffect(() => {
    try {
      if (selectedSwTag) sessionStorage.setItem(SW_TAG_STORAGE_KEY, selectedSwTag);
      else sessionStorage.removeItem(SW_TAG_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [selectedSwTag]);

  useEffect(() => {
    if (podFiltersActive(podFilters) || ownerFilter) setPodFiltersOpen(true);
  }, [podFilters, ownerFilter]);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const s = await api.getWorkspaceOauthStatus();
      const ok = Boolean(s.configured && s.token_valid && !s.needs_reauth);
      setGoogleOk(ok);
      setGoogleAccount(s.account);
      setGoogleError(s.error);
    } catch {
      setGoogleOk(null);
    }
  }, []);

  const loadDevices = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await api.getNetworkDevices();
      setDevices(data.devices);
      setSheetId(data.sheet_id);
      setHostAgent(data.host_agent ?? null);
      setSamsungPrecheckRuns((prev) => hydrateSamsungPrecheckRuns(data.devices, prev));
      setSamsungUpgradeRuns((prev) => hydrateSamsungUpgradeRuns(data.devices, prev));
      setSamsungRollbackRuns((prev) => hydrateSamsungRollbackRuns(data.devices, prev));
      setSamsungUndeploymentRuns((prev) => hydrateSamsungUndeploymentRuns(data.devices, prev));
      setSamsungDeploymentRuns((prev) => hydrateSamsungDeploymentRuns(data.devices, prev));
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load network devices');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.getNetworkSettings();
      setVendors(data.vendors);
      setWrSubcloud(
        data.wr_subcloud || {
          username: '',
          password_set: false,
          key_path_set: false,
          configured: false,
        }
      );
      setWrSshUser(data.wr_subcloud?.username || '');
      setWrSshPass('');
      const controllers = data.wr_subcloud_controllers || [];
      setWrControllers(controllers);
      setWrControllerUsers(Object.fromEntries(controllers.map((c) => [c.controller, c.username])));
      setWrControllerPasses({});
      setPrecheckCustomCommands(data.precheck_custom_commands || '');
      setPrecheckLogDir(data.precheck_log_dir || 'logs/subcloud-precheck');
      setAtlasConfigured(Boolean(data.atlas?.configured));
      setAtlasBearerSet(Boolean(data.atlas?.bearer_token_set));
      setAtlasBearerInput('');
      const sources = data.atlas?.ciq_sources?.length
        ? data.atlas.ciq_sources
        : FALLBACK_CIQ_SOURCES;
      setCiqSources(sources);
      setCiqSource((prev) =>
        sources.includes(prev) ? prev : data.atlas?.default_ciq_source || sources[0]
      );
      const tags = data.atlas?.sw_tags?.length ? data.atlas.sw_tags : [];
      setSwTags(tags);
      setSelectedSwTag((prev) => {
        const stored = prev || loadStoredSwTag();
        if (stored && tags.includes(stored)) return stored;
        if (data.atlas?.default_sw_tag && tags.includes(data.atlas.default_sw_tag)) {
          return data.atlas.default_sw_tag;
        }
        return tags[0] || '';
      });
      setMiddlewareConfigured(Boolean(data.middleware?.configured));
      const users: Record<VendorCredId, string> = { DELL: '', ZT: '', HPE: '' };
      for (const form of VENDOR_CRED_FORMS) {
        const row = data.vendors.find((v) => v.vendor.toUpperCase() === form.id);
        users[form.id] = row?.username || '';
      }
      setCredUsers(users);
      setCredPasses({ DELL: '', ZT: '', HPE: '' });
    } catch {
      /* settings panel optional */
    }
  }, []);

  const loadClusterPods = useCallback(async (silent = false) => {
    if (!silent) {
      setPodsLoading(true);
      setPodsError(null);
    }
    try {
      const data = await api.getNetworkClusterPods();
      setClusterPods(data.clusters);
      setPodsFetchedAt(data.fetched_at);
    } catch (err) {
      if (!silent) {
        setPodsError(err instanceof Error ? err.message : 'Failed to load cluster pods');
      }
    } finally {
      if (!silent) setPodsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();
    loadSettings();
    loadGoogleStatus();
  }, [loadDevices, loadSettings, loadGoogleStatus, refreshToken]);

  useEffect(() => {
    const id = setInterval(() => loadDevices(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [loadDevices]);

  useEffect(() => {
    if (activeTab !== 'pods') return;
    loadClusterPods();
    const id = setInterval(() => loadClusterPods(true), PODS_REFRESH_MS);
    return () => clearInterval(id);
  }, [activeTab, loadClusterPods, refreshToken]);

  const loadSamsungIssues = useCallback(
    async (silent = false, searchOverride?: string) => {
      if (!silent) {
        setIssuesLoading(true);
        setIssuesError(null);
      }
      const q =
        searchOverride !== undefined ? searchOverride.trim() : issuesQuery.trim();
      try {
        const data = await api.listSamsungIssues({
          q: q || undefined,
          operation: issuesOperation || undefined,
          open_only: issuesOpenOnly || undefined,
          limit: 300,
        });
        setSamsungIssues(data.issues);
        setIssuesTotal(data.total);
        setIssuesDrafts((prev) => {
          const next: Record<string, { resolved_date: string; resolution_details: string }> = {
            ...prev,
          };
          for (const issue of data.issues) {
            if (!next[issue.id]) {
              next[issue.id] = {
                resolved_date: toDateInputValue(issue.resolved_date),
                resolution_details: issue.resolution_details || '',
              };
            }
          }
          return next;
        });
      } catch (err) {
        if (!silent) {
          setIssuesError(err instanceof Error ? err.message : 'Failed to load Samsung issues');
        }
      } finally {
        if (!silent) setIssuesLoading(false);
      }
    },
    [issuesQuery, issuesOperation, issuesOpenOnly]
  );

  useEffect(() => {
    if (activeTab !== 'issues') return;
    loadSamsungIssues();
    const id = setInterval(() => loadSamsungIssues(true), ISSUES_REFRESH_MS);
    return () => clearInterval(id);
  }, [activeTab, loadSamsungIssues, refreshToken]);

  async function saveSamsungIssueResolution(issue: NetworkSamsungIssue) {
    if (!canWrite) return;
    const draft = issuesDrafts[issue.id] || {
      resolved_date: toDateInputValue(issue.resolved_date),
      resolution_details: issue.resolution_details || '',
    };
    const nextResolved = draft.resolved_date ? `${draft.resolved_date}T12:00:00.000Z` : null;
    const nextDetails = draft.resolution_details;
    const prevResolved = toDateInputValue(issue.resolved_date);
    const prevDetails = issue.resolution_details || '';
    if (prevResolved === (draft.resolved_date || '') && prevDetails === nextDetails) {
      return;
    }
    setIssuesSavingId(issue.id);
    setIssuesError(null);
    try {
      const updated = await api.updateSamsungIssue(issue.id, {
        resolved_date: nextResolved,
        resolution_details: nextDetails,
      });
      setSamsungIssues((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setIssuesDrafts((prev) => ({
        ...prev,
        [updated.id]: {
          resolved_date: toDateInputValue(updated.resolved_date),
          resolution_details: updated.resolution_details || '',
        },
      }));
      setActionMsg(`Saved resolution for ${updated.cluster_id}`);
    } catch (err) {
      setIssuesError(err instanceof Error ? err.message : 'Failed to save issue resolution');
    } finally {
      setIssuesSavingId(null);
    }
  }

  const refreshSamsungAtlasStatus = useCallback(
    async (run: SamsungPrecheckRunState, operation: SamsungAtlasOperation) => {
      if (run.status === 'cancelled') return run;
      const opts = {
        jobId: run.launcher_job_id ?? run.job_id,
        jobKind: run.job_kind,
        launchedAfter: run.launched_at,
        launcherJobId: run.launcher_job_id ?? run.job_id,
        monitorJobId: run.monitor_job_id,
        monitorJobKind: run.monitor_job_kind,
        workload: run.workload,
      };
      const status =
        operation === 'upgrade'
          ? await api.getSamsungUpgradeStatus(run.device_id, opts)
          : operation === 'rollback'
            ? await api.getSamsungRollbackStatus(run.device_id, opts)
            : operation === 'undeployment'
              ? await api.getSamsungUndeploymentStatus(run.device_id, opts)
              : operation === 'deployment'
                ? await api.getSamsungDeploymentStatus(run.device_id, opts)
                : await api.getSamsungPrecheckStatus(run.device_id, opts);
      const setter =
        operation === 'upgrade'
          ? setSamsungUpgradeRuns
          : operation === 'rollback'
            ? setSamsungRollbackRuns
            : operation === 'undeployment'
              ? setSamsungUndeploymentRuns
              : operation === 'deployment'
                ? setSamsungDeploymentRuns
                : setSamsungPrecheckRuns;
      setter((prev) => {
        const existing = prev[run.device_id];
        if (!existing) return prev;
        // An in-flight poll must not clobber a cancel the user just applied.
        if (existing.status === 'cancelled') return prev;
        return {
          ...prev,
          [run.device_id]: {
            ...existing,
            launcher_job_id: status.launcher_job_id ?? existing.launcher_job_id,
            monitor_job_id: status.monitor_job_id ?? existing.monitor_job_id,
            monitor_job_kind: status.monitor_job_kind ?? existing.monitor_job_kind,
            job_kind: status.job?.job_kind ?? existing.job_kind,
            phase: status.phase,
            status: status.status,
            message: status.message,
            job: status.job,
            launcher_job: status.launcher_job ?? existing.launcher_job,
            activity: status.activity,
            error_report: status.error_report ?? null,
            launched_at:
              status.launched_at ||
              (status.launcher_job_id &&
              existing.launcher_job_id &&
              status.launcher_job_id !== existing.launcher_job_id
                ? status.launcher_job?.started || status.job?.started || status.checked_at
                : existing.launched_at),
            updated_at: status.checked_at,
            error:
              status.status === 'failed'
                ? status.error_report?.detail || status.message
                : null,
          },
        };
      });
      return status;
    },
    []
  );

  useEffect(() => {
    function pollRuns(
      runs: Record<string, SamsungPrecheckRunState>,
      operation: SamsungAtlasOperation,
      setRuns: Dispatch<SetStateAction<Record<string, SamsungPrecheckRunState>>>
    ) {
      const maxPollMs = SAMSUNG_ATLAS_MAX_POLL_MS[operation];
      for (const run of Object.values(runs)) {
        const age = Date.now() - new Date(run.launched_at).getTime();
        const raw = run.job?.raw_status?.toLowerCase();
        const jobStillActive =
          Boolean(run.monitor_job_id || run.launcher_job_id || run.job_id) &&
          run.job &&
          !run.job.terminal &&
          raw !== 'failed' &&
          raw !== 'error' &&
          raw !== 'canceled' &&
          raw !== 'cancelled';
        const active =
          (run.status === 'running' ||
            run.status === 'pending' ||
            run.phase === 'monitoring' ||
            jobStillActive ||
            (run.status === 'unknown' && age < 60_000)) &&
          run.status !== 'failed' &&
          run.status !== 'success' &&
          run.status !== 'cancelled';
        if (!active || age > maxPollMs) continue;
        refreshSamsungAtlasStatus(run, operation).catch((err) => {
          setRuns((current) => {
            const existing = current[run.device_id];
            if (!existing) return current;
            return {
              ...current,
              [run.device_id]: {
                ...existing,
                error: err instanceof Error ? err.message : 'Status refresh failed',
                updated_at: new Date().toISOString(),
              },
            };
          });
        });
      }
    }

    const poll = () => {
      setSamsungPrecheckRuns((prev) => {
        pollRuns(prev, 'precheck', setSamsungPrecheckRuns);
        return prev;
      });
      setSamsungUpgradeRuns((prev) => {
        pollRuns(prev, 'upgrade', setSamsungUpgradeRuns);
        return prev;
      });
      setSamsungRollbackRuns((prev) => {
        pollRuns(prev, 'rollback', setSamsungRollbackRuns);
        return prev;
      });
      setSamsungUndeploymentRuns((prev) => {
        pollRuns(prev, 'undeployment', setSamsungUndeploymentRuns);
        return prev;
      });
      setSamsungDeploymentRuns((prev) => {
        pollRuns(prev, 'deployment', setSamsungDeploymentRuns);
        return prev;
      });
    };

    poll();
    const id = setInterval(poll, SAMSUNG_PRECHECK_POLL_MS);
    return () => clearInterval(id);
  }, [refreshSamsungAtlasStatus]);

  async function handleRefreshClusterPods(deviceId: string) {
    setRefreshingPodIds((prev) => new Set(prev).add(deviceId));
    setPodsError(null);
    try {
      const result = await api.getNetworkDevicePods(deviceId);
      setClusterPods((prev) => prev.map((c) => (c.device_id === deviceId ? result : c)));
      setExpandedPodClusterIds((prev) => new Set(prev).add(deviceId));
    } catch (err) {
      setPodsError(err instanceof Error ? err.message : 'Failed to refresh pods');
      throw err;
    } finally {
      setRefreshingPodIds((prev) => {
        const next = new Set(prev);
        next.delete(deviceId);
        return next;
      });
    }
  }

  function togglePodDeviceSelection(deviceId: string) {
    setSelectedPodDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  function resetPodFilters() {
    setPodFilters({ ...DEFAULT_POD_FILTERS });
    setOwnerFilter('');
  }

  function selectVisiblePodDevices(deviceIds: string[]) {
    setSelectedPodDeviceIds(new Set(deviceIds));
  }

  function toggleAllPodDeviceSelection(deviceIds: string[]) {
    setSelectedPodDeviceIds((prev) => {
      const allSelected = deviceIds.length > 0 && deviceIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(deviceIds);
    });
  }

  function promptSamsungAtlasVersion(
    devices: NetworkDevice[],
    operation: SamsungAtlasOperation
  ): string | null {
    if (devices.length === 0) return null;

    // Prefer SW TAG dropdown from vDU_List → Application SW sheet.
    if (swTags.length > 0) {
      if (!selectedSwTag.trim()) {
        setPodsError(
          'Select an SW TAG before launching Samsung Atlas actions (loaded from Application SW sheet)'
        );
        return null;
      }
      return selectedSwTag.trim();
    }

    if (operation === 'rollback') {
      const lines = devices.map((device) => {
        const podRow = clusterPods.find((c) => c.device_id === device.id);
        const tracker = device.samsung_software_tracker;
        const upgradeSnap = device.samsung_upgrade_snapshot;
        const suggested =
          tracker?.rollback_release ||
          upgradeSnap?.previous_version ||
          podRow?.software_version ||
          '';
        return `${device.cluster_id}: rollback baseline ${tracker?.rollback_release || suggested || '—'}`;
      });
      const first = devices[0];
      const firstPod = clusterPods.find((c) => c.device_id === first.id);
      const defaultVersion =
        first.samsung_software_tracker?.rollback_release ||
        first.samsung_upgrade_snapshot?.previous_version ||
        firstPod?.software_version ||
        '';
      const version = window.prompt(
        `Samsung Atlas ROLLBACK for ${devices.length} gNB DUID(s)\n\n${lines.join('\n')}\n\nEnter the pre-upgrade software version to roll back to (same version applied to all selected):`,
        defaultVersion
      );
      return version?.trim() || null;
    }

    if (operation === 'undeployment') {
      const lines = devices.map((device) => {
        const podRow = clusterPods.find((c) => c.device_id === device.id);
        const suggested =
          device.samsung_software_tracker?.current_release || podRow?.software_version || '';
        return `${device.cluster_id}: current SW ${suggested || '—'}`;
      });
      const first = devices[0];
      const firstPod = clusterPods.find((c) => c.device_id === first.id);
      const defaultVersion =
        first.samsung_software_tracker?.current_release ||
        firstPod?.software_version ||
        '';
      const version = window.prompt(
        `Samsung Atlas UNDEPLOYMENT for ${devices.length} gNB DUID(s)\n\n${lines.join('\n')}\n\nEnter the current running software version (same version applied to all selected):`,
        defaultVersion
      );
      return version?.trim() || null;
    }

    if (operation === 'deployment') {
      const first = devices[0];
      const firstPod = clusterPods.find((c) => c.device_id === first.id);
      const defaultVersion = firstPod?.software_version || '';
      const duidList = devices.map((d) => d.cluster_id).join(', ');
      const version = window.prompt(
        `Samsung Atlas DEPLOYMENT for ${devices.length} gNB DUID(s)\n\n${duidList}\n\nEnter the software version to deploy (same version applied to all selected):`,
        defaultVersion
      );
      return version?.trim() || null;
    }

    const first = devices[0];
    const firstPod = clusterPods.find((c) => c.device_id === first.id);
    const defaultVersion =
      first.samsung_precheck_snapshot?.version || firstPod?.software_version || '';
    const duidList = devices.map((d) => d.cluster_id).join(', ');
    const version = window.prompt(
      operation === 'upgrade'
        ? `Samsung Atlas UPGRADE for ${devices.length} gNB DUID(s)\n\n${duidList}\n\nEnter the target software version (must match successful precheck):`
        : devices.length === 1
          ? `Samsung Atlas precheck for gNB DUID ${first.cluster_id}\n\nEnter the target software version for the upgrade precheck (e.g. 23.B.0-0100):`
          : `Samsung Atlas precheck for ${devices.length} gNB DUID(s)\n\n${duidList}\n\nEnter the target software version (same version applied to all selected):`,
      defaultVersion
    );
    return version?.trim() || null;
  }

  function confirmSamsungAtlasBatch(
    devices: NetworkDevice[],
    operation: SamsungAtlasOperation,
    version: string
  ): boolean {
    const duidList = devices.map((d) => d.cluster_id).join('\n');
    const message =
      operation === 'rollback'
        ? `Launch Samsung Atlas ROLLBACK on ${devices.length} gNB DUID(s)?\n\n${duidList}\n\nRollback to version: ${version}\n\nAtlas will run the UDU or VDU rollback job template on each. Continue?`
        : operation === 'upgrade'
          ? `Launch Samsung Atlas UPGRADE on ${devices.length} gNB DUID(s)?\n\n${duidList}\n\nTarget version: ${version}\n\nEnsure precheck passed for this version. Continue?`
          : operation === 'undeployment'
            ? `Launch Samsung Atlas UNDEPLOYMENT on ${devices.length} gNB DUID(s)?\n\n${duidList}\n\nCurrent SW version: ${version}\n\nAtlas will run the UDU or VDU Zero Touch undeployment workflow on each. Continue?`
            : operation === 'deployment'
              ? `Launch Samsung Atlas DEPLOYMENT on ${devices.length} gNB DUID(s)?\n\n${duidList}\n\nVersion to deploy: ${version}\nCIQ source: ${ciqSource}\n\nAtlas will run the UDU or VDU Zero Touch deployment workflow on each. Continue?`
              : `Launch Samsung Atlas precheck on ${devices.length} gNB DUID(s)?\n\n${duidList}\n\nTarget version: ${version}\n\nAtlas will run the UDU or VDU precheck job template on each. Continue?`;
    return window.confirm(message);
  }

  function isSamsungDevice(device: NetworkDevice) {
    return (device.application || '').toLowerCase().includes('samsung');
  }

  function inferSamsungWorkload(
    row: NetworkClusterPodsResult | undefined,
    device: NetworkDevice
  ): 'UDU' | 'VDU' | null {
    const names = (row?.pods || []).map((p) => p.name.toLowerCase());
    if (names.some((n) => n.includes('uadpf'))) return 'UDU';
    if (names.some((n) => n.includes('adpf'))) return 'VDU';
    const st = String(device.site_type || '').toUpperCase();
    if (/\bUDU\b/.test(st)) return 'UDU';
    if (/\bVDU\b/.test(st)) return 'VDU';
    const sv = String(row?.software_version || row?.build_info?.version || '').toUpperCase();
    if (/\bUDU\b/.test(sv)) return 'UDU';
    if (/\bVDU\b/.test(sv)) return 'VDU';
    const mt = String(device.model_type || '').toUpperCase();
    if (mt.includes('UDU')) return 'UDU';
    if (mt.includes('VDU')) return 'VDU';
    return null;
  }

  function clearSamsungAtlasLifecycleUi(deviceId: string) {
    setSamsungPrecheckRuns((prev) => {
      if (!prev[deviceId]) return prev;
      const { [deviceId]: _removed, ...rest } = prev;
      return rest;
    });
    setSamsungUpgradeRuns((prev) => {
      if (!prev[deviceId]) return prev;
      const { [deviceId]: _removed, ...rest } = prev;
      return rest;
    });
    setSamsungRollbackRuns((prev) => {
      if (!prev[deviceId]) return prev;
      const { [deviceId]: _removed, ...rest } = prev;
      return rest;
    });
    setExpandedSamsungPrecheckId((id) => (id === deviceId ? null : id));
    setExpandedSamsungUpgradeId((id) => (id === deviceId ? null : id));
    setExpandedSamsungRollbackId((id) => (id === deviceId ? null : id));
    setDevices((prev) =>
      prev.map((d) =>
        d.id !== deviceId
          ? d
          : {
              ...d,
              samsung_precheck_snapshot: null,
              samsung_upgrade_snapshot: null,
              samsung_rollback_snapshot: null,
              samsung_software_tracker: d.samsung_software_tracker
                ? {
                    ...d.samsung_software_tracker,
                    rollback_release: null,
                    rollback_display: null,
                    rollback_captured_at: null,
                  }
                : null,
            }
      )
    );
  }

  async function handleSamsungAtlas(
    device: NetworkDevice,
    operation: SamsungAtlasOperation,
    options: { version?: string; skipVersionPrompt?: boolean; skipConfirm?: boolean } = {}
  ): Promise<boolean> {
    if (!atlasConfigured) {
      setPodsError(
        'Atlas not configured — set NETWORK_ATLAS_BEARER_TOKEN or NETWORK_ATLAS_USERNAME/PASSWORD in .env and restart the host poller'
      );
      return false;
    }

    const podRow = clusterPods.find((c) => c.device_id === device.id);
    const upgradeSnap = device.samsung_upgrade_snapshot;

    let version: string | null = options.version ?? null;

    if (!version && !options.skipVersionPrompt) {
      version = promptSamsungAtlasVersion([device], operation);
      if (!version) return false;
    } else if (!version) {
      return false;
    }

    const inferredWorkload = inferSamsungWorkload(podRow, device);

    if (!options.skipConfirm) {
      const confirmMessage =
        operation === 'rollback'
          ? `Launch Samsung Atlas ROLLBACK?\n\ngNB DUID: ${device.cluster_id}\nRollback to version: ${version.trim()}\n${upgradeSnap?.version ? `Reverting from upgrade target: ${upgradeSnap.version}\n` : ''}Workload: ${inferredWorkload || 'auto-detect'}\n\nAtlas will run the UDU or VDU rollback job template. Continue?`
          : operation === 'upgrade'
            ? `Launch Samsung Atlas UPGRADE?\n\ngNB DUID: ${device.cluster_id}\nTarget version: ${version.trim()}\nWorkload: ${inferredWorkload || 'auto-detect'}\n\nEnsure precheck passed for this version. Atlas will run the UDU or VDU upgrade job template. Continue?`
            : operation === 'undeployment'
              ? `Launch Samsung Atlas UNDEPLOYMENT?\n\ngNB DUID: ${device.cluster_id}\nCurrent SW version: ${version.trim()}\nWorkload: ${inferredWorkload || 'auto-detect'}\n\nAtlas will run the UDU or VDU Zero Touch undeployment workflow. Continue?`
              : operation === 'deployment'
                ? `Launch Samsung Atlas DEPLOYMENT?\n\ngNB DUID: ${device.cluster_id}\nVersion to deploy: ${version.trim()}\nCIQ source: ${ciqSource}\nWorkload: ${inferredWorkload || 'auto-detect'}\n\nAtlas will run the UDU or VDU Zero Touch deployment workflow. Continue?`
                : `Launch Samsung Atlas precheck?\n\ngNB DUID: ${device.cluster_id}\nTarget version: ${version.trim()}\nWorkload: ${inferredWorkload || 'auto-detect'}\n\nAtlas will run the UDU or VDU precheck job template. Continue?`;

      const ok = window.confirm(confirmMessage);
      if (!ok) return false;
    }

    if (operation === 'undeployment') {
      clearSamsungAtlasLifecycleUi(device.id);
    }

    const setBusy =
      operation === 'upgrade'
        ? setSamsungUpgradingId
        : operation === 'rollback'
          ? setSamsungRollbackingId
          : operation === 'undeployment'
            ? setSamsungUndeployingId
            : operation === 'deployment'
              ? setSamsungDeployingId
              : setSamsungPrecheckingId;
    const setExpanded =
      operation === 'upgrade'
        ? setExpandedSamsungUpgradeId
        : operation === 'rollback'
          ? setExpandedSamsungRollbackId
          : operation === 'undeployment'
            ? setExpandedSamsungUndeploymentId
            : operation === 'deployment'
              ? setExpandedSamsungDeploymentId
              : setExpandedSamsungPrecheckId;
    const setRuns =
      operation === 'upgrade'
        ? setSamsungUpgradeRuns
        : operation === 'rollback'
          ? setSamsungRollbackRuns
          : operation === 'undeployment'
            ? setSamsungUndeploymentRuns
            : operation === 'deployment'
              ? setSamsungDeploymentRuns
              : setSamsungPrecheckRuns;

    const launchMessage =
      operation === 'upgrade'
        ? 'Launching Atlas upgrade job…'
        : operation === 'rollback'
          ? 'Launching Atlas rollback job…'
          : operation === 'undeployment'
            ? 'Launching Atlas undeployment workflow…'
            : operation === 'deployment'
              ? 'Launching Atlas deployment workflow…'
              : 'Launching Atlas precheck job…';

    setBusy(device.id);
    setActionMsg(null);
    setPodsError(null);
    setExpanded(device.id);
    const launchedAt = new Date().toISOString();
    setRuns((prev) => ({
      ...prev,
      [device.id]: {
        device_id: device.id,
        cluster_id: device.cluster_id,
        operation,
        version: version.trim(),
        ciq_source: operation === 'deployment' ? ciqSource : null,
        workload: inferredWorkload || 'VDU',
        template_id: 0,
        job_id: null,
        job_kind: null,
        phase: 'queued',
        status: 'pending',
        message: launchMessage,
        job: null,
        activity: { cluster_id: device.cluster_id, status: 'unknown', count: 0, recent: [] },
        launched_at: launchedAt,
        updated_at: launchedAt,
        error: null,
      },
    }));
    try {
      const payload = {
        version: version.trim(),
        confirm_cluster_id: device.cluster_id,
        ...(inferredWorkload ? { workload: inferredWorkload } : {}),
        ...(operation === 'deployment' ? { ciq_source: ciqSource } : {}),
      };
      const result =
        operation === 'upgrade'
          ? await api.runSamsungUpgrade(device.id, payload)
          : operation === 'rollback'
            ? await api.runSamsungRollback(device.id, payload)
            : operation === 'undeployment'
              ? await api.runSamsungUndeployment(device.id, payload)
              : operation === 'deployment'
                ? await api.runSamsungDeployment(device.id, payload)
                : await api.runSamsungPrecheck(device.id, payload);
      const updatedAt = new Date().toISOString();
      setRuns((prev) => ({
        ...prev,
        [device.id]: {
          device_id: device.id,
          cluster_id: result.cluster_id,
          operation,
          version: result.version,
          ciq_source: result.ciq_source ?? null,
          workload: result.workload,
          template_id: result.template_id,
          job_id: result.job_id,
          job_kind: result.job_kind ?? result.job?.job_kind ?? null,
          launcher_job_id: result.launcher_job_id ?? result.job_id,
          monitor_job_id: result.monitor_job_id ?? null,
          monitor_job_kind: result.monitor_job_kind ?? null,
          phase: result.phase,
          status: result.status,
          message: result.message,
          job: result.job,
          launcher_job: result.launcher_job ?? null,
          activity: result.activity,
          launched_at: result.launched_at,
          updated_at: updatedAt,
          error: null,
        },
      }));
      setActionMsg(
        `${result.cluster_id} Samsung ${operation} launched${result.launcher_job_id ? ` (launcher #${result.launcher_job_id})` : ''} — ${result.message}`
      );
      loadDevices(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : `Samsung ${operation} failed`;
      setPodsError(message);
      setRuns((prev) => ({
        ...prev,
        [device.id]: {
          ...(prev[device.id] || {
            device_id: device.id,
            cluster_id: device.cluster_id,
            operation,
            version: version.trim(),
            workload: 'VDU',
            template_id: 0,
            job_id: null,
            launched_at: launchedAt,
            job: null,
            activity: { cluster_id: device.cluster_id, status: 'unknown', count: 0, recent: [] },
          }),
          phase: 'complete',
          status: 'failed',
          message: 'Launch failed',
          error: message,
          updated_at: new Date().toISOString(),
        },
      }));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleSamsungAtlasCancel(
    device: NetworkDevice,
    operation: 'upgrade' | 'rollback' | 'undeployment' | 'deployment'
  ) {
    const opLabel =
      operation === 'upgrade'
        ? 'upgrade'
        : operation === 'rollback'
          ? 'rollback'
          : operation === 'undeployment'
            ? 'undeployment'
            : 'deployment';
    const ok = window.confirm(
      `Cancel ${opLabel} monitoring for gNB DUID ${device.cluster_id}?\n\nThis stops dashboard polling only. It does NOT cancel Atlas jobs or change MP status.\n\nUse when Atlas succeeded but MP shows failed, or you need to clear a stuck run.`
    );
    if (!ok) return;

    const reason =
      window.prompt(
        'Optional note (e.g. "Atlas successful, MP shows failed"):',
        'Atlas successful on wrapper — MP status unavailable'
      ) ?? '';

    setSamsungCancellingId(device.id);
    setPodsError(null);
    try {
      const result =
        operation === 'upgrade'
          ? await api.cancelSamsungUpgrade(device.id, { reason: reason.trim() || undefined })
          : operation === 'rollback'
            ? await api.cancelSamsungRollback(device.id, { reason: reason.trim() || undefined })
            : operation === 'undeployment'
              ? await api.cancelSamsungUndeployment(device.id, { reason: reason.trim() || undefined })
              : await api.cancelSamsungDeployment(device.id, { reason: reason.trim() || undefined });

      const setter =
        operation === 'upgrade'
          ? setSamsungUpgradeRuns
          : operation === 'rollback'
            ? setSamsungRollbackRuns
            : operation === 'undeployment'
              ? setSamsungUndeploymentRuns
              : setSamsungDeploymentRuns;

      setter((prev) => ({
        ...prev,
        [device.id]: {
          ...(prev[device.id] || {
            device_id: device.id,
            cluster_id: device.cluster_id,
            operation,
            version: '',
            workload: 'VDU',
            template_id: 0,
            job_id: null,
            phase: 'complete',
            status: 'cancelled',
            message: result.message,
            job: null,
            activity: { cluster_id: device.cluster_id, status: 'unknown', count: 0, recent: [] },
            launched_at: result.updated_at,
            updated_at: result.updated_at,
          }),
          status: 'cancelled',
          phase: 'complete',
          message: result.message,
          cancelled_at: result.cancelled_at,
          cancelled_reason: result.cancelled_reason ?? null,
          updated_at: result.updated_at,
          error: null,
        },
      }));
      setActionMsg(`${device.cluster_id} Samsung ${opLabel} monitoring cancelled`);
      loadDevices(true);
    } catch (err) {
      setPodsError(err instanceof Error ? err.message : `Samsung ${opLabel} cancel failed`);
    } finally {
      setSamsungCancellingId(null);
    }
  }

  async function handlePrecheck(device: NetworkDevice) {
    setPrecheckingId(device.id);
    setActionMsg(null);
    setError(null);
    try {
      const result = await api.precheckNetworkDevice(device.id);
      const logHint = result.log_file ? ` Log: ${result.log_file}` : '';
      setActionMsg(`${device.cluster_id} precheck: ${result.summary}.${logHint}`);
      setExpandedPrecheckId(device.id);
      await loadDevices(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Precheck failed');
    } finally {
      setPrecheckingId(null);
    }
  }

  async function handleReboot(device: NetworkDevice) {
    const power = hostPowerLabel(device.snapshot?.health?.system?.power, device.snapshot?.redfish_ok);
    const ok = window.confirm(
      `Host reboot ${device.cluster_id}?\n\nBMC: ${device.bmc_ip}\nPower: ${power}\nReset: PowerCycle\n\nThis power-cycles the host via Redfish (ComputerSystem.Reset PowerCycle). The BMC stays online. Continue?`
    );
    if (!ok) return;

    setRebootingId(device.id);
    setActionMsg(null);
    setError(null);
    try {
      const result = await api.rebootNetworkDevice(device.id, {
        confirm_cluster_id: device.cluster_id,
        reset_type: 'PowerCycle',
      });
      setActionMsg(
        `Host reboot sent for ${result.cluster_id} (${result.reset_type}${result.via ? ` via ${result.via}` : ''})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Host reboot failed');
    } finally {
      setRebootingId(null);
    }
  }

  async function handleBmcReset(device: NetworkDevice) {
    const isZt = (device.vendor || '').toUpperCase().includes('ZT');
    const resetDesc = isZt
      ? 'ipmitool mc reset warm (GracefulRestart)'
      : 'Redfish Manager.Reset (GracefulRestart)';
    const ok = window.confirm(
      `BMC reset ${device.cluster_id}?\n\nBMC: ${device.bmc_ip}\nVendor: ${device.vendor || '—'}\nMethod: ${resetDesc}\n\nThis restarts the BMC controller (iDRAC/iLO/IPMI), not the host. You may lose BMC access briefly. Continue?`
    );
    if (!ok) return;

    setBmcResettingId(device.id);
    setActionMsg(null);
    setError(null);
    try {
      const result = await api.resetBmcNetworkDevice(device.id, {
        confirm_cluster_id: device.cluster_id,
        reset_type: 'GracefulRestart',
      });
      const methodHint =
        result.method === 'ipmitool'
          ? ` via ipmitool ${result.ipmitool_mode || 'warm'}`
          : result.manager
            ? ` on ${result.manager}`
            : '';
      setActionMsg(
        `BMC reset sent for ${result.cluster_id} (${result.reset_type}${methodHint}${result.via ? ` via ${result.via}` : ''})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BMC reset failed');
    } finally {
      setBmcResettingId(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSyncNote(null);
    try {
      const res = await api.syncNetworkDevices();
      const mw = res.middleware;
      const sw = res.sheet_writeback;
      const parts = [`Synced ${res.synced} device(s)`];
      if (mw?.enabled) {
        const errCount = mw.errors?.length || 0;
        parts.push(
          `middleware refreshed ${mw.updated ?? 0} field(s) on ${mw.matched ?? 0} cluster(s)${errCount ? ` (${errCount} site error(s))` : ''}`
        );
      }
      if (sw?.enabled && !sw.skipped) {
        if (sw.error) {
          parts.push(`sheet writeback failed: ${sw.error}`);
        } else if ((sw.cells ?? 0) > 0) {
          parts.push(`updated ${sw.cells} cell(s) on vDU_List (${sw.rows} row(s))`);
        } else {
          parts.push('vDU_List already up to date');
        }
      }
      if (res.application_sw?.tags?.length) {
        parts.push(`loaded ${res.application_sw.tags.length} SW TAG(s)`);
      } else if (res.application_sw?.error) {
        parts.push(`SW TAG load failed: ${res.application_sw.error}`);
      }
      setSyncNote(`${parts.join('. ')}.`);
      await loadDevices(true);
      await loadSettings();
      await loadGoogleStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      await loadGoogleStatus();
      setShowSettings(true);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveAtlasBearer(e: FormEvent) {
    e.preventDefault();
    const token = atlasBearerInput.trim();
    if (!token) {
      setCredsMsg('Paste a new Atlas bearer token before saving');
      return;
    }
    setSavingAtlasBearer(true);
    setCredsMsg(null);
    try {
      await api.updateAtlasBearerToken(token);
      setAtlasBearerInput('');
      setCredsMsg('Atlas bearer token saved — takes effect immediately');
      await loadSettings();
    } catch (err) {
      setCredsMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingAtlasBearer(false);
    }
  }

  async function handleSavePrecheckCustom(e: FormEvent) {
    e.preventDefault();
    setSavingPrecheckCustom(true);
    setCredsMsg(null);
    try {
      const res = await api.updatePrecheckCustomCommands(precheckCustomCommands);
      setPrecheckCustomCommands(res.precheck_custom_commands);
      setCredsMsg(`Saved ${res.count} custom precheck command(s)`);
    } catch (err) {
      setCredsMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingPrecheckCustom(false);
    }
  }

  async function handleSaveWrController(e: FormEvent, controller: string) {
    e.preventDefault();
    setSavingWrController(controller);
    setCredsMsg(null);
    try {
      const res = await api.updateWrSubcloudControllerSettings({
        controller,
        username: wrControllerUsers[controller],
        password: wrControllerPasses[controller] || undefined,
      });
      setWrControllerPasses((prev) => ({ ...prev, [controller]: '' }));
      if (res.wr_subcloud_controllers) {
        setWrControllers(res.wr_subcloud_controllers);
        setWrControllerUsers(
          Object.fromEntries(res.wr_subcloud_controllers.map((c) => [c.controller, c.username]))
        );
      }
      setCredsMsg(`WR SSH saved for ${controller}`);
    } catch (err) {
      setCredsMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingWrController(null);
    }
  }

  async function handleSaveWrSsh(e: FormEvent) {
    e.preventDefault();
    setSavingWrSsh(true);
    setCredsMsg(null);
    try {
      await api.updateWrSubcloudSettings({
        username: wrSshUser,
        password: wrSshPass || undefined,
      });
      setWrSshPass('');
      setCredsMsg('Wind River SSH credentials saved');
      await loadSettings();
    } catch (err) {
      setCredsMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingWrSsh(false);
    }
  }

  async function handleSaveCreds(e: FormEvent, vendor: VendorCredId) {
    e.preventDefault();
    setSavingCreds(vendor);
    setCredsMsg(null);
    try {
      await api.updateNetworkSettings({
        vendor,
        username: credUsers[vendor],
        password: credPasses[vendor] || undefined,
      });
      setCredPasses((prev) => ({ ...prev, [vendor]: '' }));
      setCredsMsg(`${vendor} Redfish credentials saved`);
      await loadSettings();
      await api.syncNetworkDevices().catch(() => undefined);
      await loadDevices(true);
    } catch (err) {
      setCredsMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingCreds(null);
    }
  }

  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();
    for (const device of devices) {
      if (device.owner?.trim()) owners.add(device.owner.trim());
    }
    return [...owners].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [devices]);

  const visibleDevices = useMemo(
    () =>
      ownerFilter
        ? devices.filter((d) => (d.owner || '').trim() === ownerFilter)
        : devices,
    [devices, ownerFilter]
  );

  const upCount = visibleDevices.filter((d) => d.snapshot?.reachable).length;
  const redfishOk = visibleDevices.filter((d) => d.snapshot?.redfish_ok).length;
  const hostPowerOn = visibleDevices.filter(
    (d) => hostPowerKind(d.snapshot?.health?.system?.power) === 'on'
  ).length;
  const hostPowerOff = visibleDevices.filter(
    (d) => hostPowerKind(d.snapshot?.health?.system?.power) === 'off'
  ).length;
  const bmcSessionTotal = visibleDevices.reduce((sum, d) => {
    const c = d.snapshot?.health?.sessions?.count;
    return sum + (typeof c === 'number' ? c : 0);
  }, 0);
  const bmcSessionMonitored = visibleDevices.filter(
    (d) => d.snapshot?.redfish_ok && d.snapshot?.health?.sessions?.count != null
  ).length;

  const subcloudDevices = visibleDevices.filter((d) => d.subcloud_ip?.trim());
  const subcloudUp = subcloudDevices.filter((d) => d.subcloud_snapshot?.reachable).length;
  const subcloudLatencies = subcloudDevices
    .map((d) => d.subcloud_snapshot?.latency_ms)
    .filter((ms): ms is number => ms != null && !Number.isNaN(ms));
  const subcloudAvgLatency =
    subcloudLatencies.length > 0
      ? Math.round(subcloudLatencies.reduce((a, b) => a + b, 0) / subcloudLatencies.length)
      : null;
  const precheckPass = subcloudDevices.filter((d) => d.precheck_snapshot?.status === 'pass').length;
  const precheckWarn = subcloudDevices.filter((d) => d.precheck_snapshot?.status === 'warn').length;
  const precheckFail = subcloudDevices.filter((d) => d.precheck_snapshot?.status === 'fail').length;

  const namespaceDevices = visibleDevices.filter((d) => d.cluster_namespace?.trim());

  const podFilterOptions = useMemo(() => {
    const applications = new Set<string>();
    const platforms = new Set<string>();
    const parentControllers = new Set<string>();
    for (const device of namespaceDevices) {
      if (device.application?.trim()) applications.add(device.application.trim());
      const row = getPodRowForDevice(device, clusterPods);
      const platform = (row.platform || device.os || '').trim();
      if (platform) platforms.add(platform);
      if (device.parent_controller?.trim()) parentControllers.add(device.parent_controller.trim());
    }
    return {
      applications: [...applications].sort(),
      platforms: [...platforms].sort(),
      parentControllers: [...parentControllers].sort(),
    };
  }, [namespaceDevices, clusterPods]);

  const filteredPodDevices = useMemo(
    () =>
      namespaceDevices.filter((device) => {
        const row = getPodRowForDevice(device, clusterPods);
        return deviceMatchesPodFilters(
          device,
          row,
          podFilters,
          samsungPrecheckRuns,
          samsungUpgradeRuns,
          samsungRollbackRuns,
          samsungUndeploymentRuns,
          samsungDeploymentRuns
        );
      }),
    [
      namespaceDevices,
      clusterPods,
      podFilters,
      samsungPrecheckRuns,
      samsungUpgradeRuns,
      samsungRollbackRuns,
      samsungUndeploymentRuns,
      samsungDeploymentRuns,
    ]
  );

  const filteredPodDeviceIds = filteredPodDevices.map((d) => d.id);
  const podsFiltersApplied = podFiltersActive(podFilters) || Boolean(ownerFilter);

  const podsRunningTotal = clusterPods.reduce((sum, c) => sum + (c.running || 0), 0);
  const podsNotRunningTotal = clusterPods.reduce((sum, c) => sum + (c.not_running || 0), 0);
  const podsClusterErrors = clusterPods.filter((c) => c.error).length;
  const allPodsSelected =
    filteredPodDeviceIds.length > 0 &&
    filteredPodDeviceIds.every((id) => selectedPodDeviceIds.has(id));
  const podBulkActionMeta = POD_BULK_ACTIONS.find((a) => a.id === podBulkAction);
  const podBulkDisabled =
    // Only the pod display toggles are safe for a read-only account; every other
    // bulk action starts a deployment, upgrade, rollback, or undeployment.
    (!canWrite && podBulkAction !== 'show_pods' && podBulkAction !== 'hide_pods') ||
    podBulkRunning ||
    selectedPodDeviceIds.size === 0 ||
    (podBulkActionMeta?.requiresMiddleware && !middlewareConfigured) ||
    (podBulkActionMeta?.requiresMiddleware &&
      !namespaceDevices.some(
        (d) => selectedPodDeviceIds.has(d.id) && d.cluster_name?.trim()
      )) ||
    (podBulkActionMeta?.samsungOnly && !atlasConfigured) ||
    (podBulkActionMeta?.samsungOnly &&
      !namespaceDevices.some((d) => selectedPodDeviceIds.has(d.id) && isSamsungDevice(d)));

  async function runPodBulkAction() {
    const selectedIds = [...selectedPodDeviceIds];
    if (!selectedIds.length) {
      setPodsError('Select at least one gNB DUID');
      return;
    }

    const selectedDevices = namespaceDevices.filter((d) => selectedIds.includes(d.id));
    const actionMeta = POD_BULK_ACTIONS.find((a) => a.id === podBulkAction);
    if (!actionMeta) return;

    if (podBulkAction === 'show_pods') {
      setExpandedPodClusterIds((prev) => {
        const next = new Set(prev);
        for (const id of selectedIds) next.add(id);
        return next;
      });
      setActionMsg(`Showing pods for ${selectedIds.length} gNB DUID(s)`);
      return;
    }

    if (podBulkAction === 'hide_pods') {
      setExpandedPodClusterIds((prev) => {
        const next = new Set(prev);
        for (const id of selectedIds) next.delete(id);
        return next;
      });
      setActionMsg(`Hid pods for ${selectedIds.length} gNB DUID(s)`);
      return;
    }

    if (podBulkAction === 'refresh') {
      setPodBulkRunning(true);
      setPodsError(null);
      let ok = 0;
      let failed = 0;
      for (const id of selectedIds) {
        try {
          await handleRefreshClusterPods(id);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      setPodBulkRunning(false);
      setActionMsg(
        failed
          ? `Refreshed ${ok}/${selectedIds.length} gNB DUID(s) (${failed} failed)`
          : `Refreshed pods for ${ok} gNB DUID(s)`
      );
      return;
    }

    if (podBulkAction === 'connection_details') {
      const withCluster = selectedDevices.filter((d) => d.cluster_name?.trim());
      const missing = selectedDevices.filter((d) => !d.cluster_name?.trim());
      if (!withCluster.length) {
        setPodsError('Selected gNB DUIDs have no cluster name — run Sync from Drive');
        return;
      }
      if (missing.length) {
        const skipped = missing.map((d) => d.cluster_id).join(', ');
        const proceed = window.confirm(
          `Connection details requires cluster name.\n\nSkipping: ${skipped}\n\nContinue with ${withCluster.length} gNB DUID(s)?`
        );
        if (!proceed) return;
      }

      setPodBulkRunning(true);
      setPodsError(null);
      let ok = 0;
      let failed = 0;
      for (const device of withCluster) {
        const clusterName = device.cluster_name!.trim();
        setConnectionDetailsByDevice((prev) => ({
          ...prev,
          [device.id]: {
            device_id: device.id,
            cluster_id: device.cluster_id,
            cluster_name: clusterName,
            status: 'loading',
          },
        }));
        setExpandedConnectionDetailsIds((prev) => new Set(prev).add(device.id));
        try {
          const result = await api.getNetworkConnectionDetails(device.id);
          setConnectionDetailsByDevice((prev) => ({
            ...prev,
            [device.id]: {
              device_id: result.device_id,
              cluster_id: result.cluster_id,
              cluster_name: result.cluster_name,
              status: 'success',
              data: result.data,
              url: result.url,
              fetched_at: result.fetched_at,
              via: result.via,
            },
          }));
          ok += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Connection details failed';
          setConnectionDetailsByDevice((prev) => ({
            ...prev,
            [device.id]: {
              device_id: device.id,
              cluster_id: device.cluster_id,
              cluster_name: clusterName,
              status: 'failed',
              error: message,
              fetched_at: new Date().toISOString(),
            },
          }));
          failed += 1;
        }
      }
      setPodBulkRunning(false);
      setActionMsg(
        failed
          ? `Connection details: ${ok}/${withCluster.length} loaded (${failed} failed)`
          : `Connection details loaded for ${ok} gNB DUID(s)`
      );
      return;
    }

    if (podBulkAction === 'setup_cluster') {
      const withCluster = selectedDevices.filter((d) => d.cluster_name?.trim());
      const missing = selectedDevices.filter((d) => !d.cluster_name?.trim());
      if (!withCluster.length) {
        setPodsError('Selected gNB DUIDs have no cluster name — run Sync from Drive');
        return;
      }
      if (missing.length) {
        const skipped = missing.map((d) => d.cluster_id).join(', ');
        const proceed = window.confirm(
          `Setup cluster requires cluster name (not gNB DUID).\n\nSkipping: ${skipped}\n\nContinue with ${withCluster.length} gNB DUID(s)?`
        );
        if (!proceed) return;
      }

      setPodBulkRunning(true);
      setPodsError(null);
      let ok = 0;
      let failed = 0;
      const names: string[] = [];
      const errors: string[] = [];
      for (const device of withCluster) {
        const clusterName = device.cluster_name!.trim();
        try {
          await api.postNetworkSetupCluster(device.id);
          ok += 1;
          names.push(`${device.cluster_id} → ${clusterName}`);
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : 'Setup cluster failed';
          errors.push(`${device.cluster_id}: ${message}`);
        }
      }
      setPodBulkRunning(false);
      if (errors.length) {
        setPodsError(errors.slice(0, 3).join(' · '));
      }
      setActionMsg(
        failed
          ? `Setup cluster: ${ok}/${withCluster.length} triggered (${failed} failed)${names.length ? ` · ${names.slice(0, 3).join('; ')}${names.length > 3 ? '…' : ''}` : ''}`
          : `Setup cluster triggered for ${ok} gNB DUID(s): ${names.slice(0, 3).join('; ')}${names.length > 3 ? '…' : ''}`
      );
      return;
    }

    const samsungDevices = selectedDevices.filter(isSamsungDevice);
    if (!samsungDevices.length) {
      setPodsError(`${actionMeta.label} requires Samsung application devices`);
      return;
    }
    if (samsungDevices.length < selectedDevices.length) {
      const skipped = selectedDevices
        .filter((d) => !isSamsungDevice(d))
        .map((d) => d.cluster_id)
        .join(', ');
      const proceed = window.confirm(
        `${actionMeta.label} applies to Samsung devices only.\n\nSkipping non-Samsung: ${skipped}\n\nContinue with ${samsungDevices.length} Samsung gNB DUID(s)?`
      );
      if (!proceed) return;
    }

    const operation: SamsungAtlasOperation =
      podBulkAction === 'samsung_precheck'
        ? 'precheck'
        : podBulkAction === 'samsung_upgrade'
          ? 'upgrade'
          : podBulkAction === 'samsung_undeployment'
            ? 'undeployment'
            : podBulkAction === 'samsung_deployment'
              ? 'deployment'
              : 'rollback';

    const version = promptSamsungAtlasVersion(samsungDevices, operation);
    if (!version) return;
    if (!confirmSamsungAtlasBatch(samsungDevices, operation, version)) return;

    setPodBulkRunning(true);
    setPodsError(null);
    let ok = 0;
    let failed = 0;
    for (const device of samsungDevices) {
      const success = await handleSamsungAtlas(device, operation, {
        version,
        skipVersionPrompt: true,
        skipConfirm: true,
      });
      if (success) ok += 1;
      else failed += 1;
    }
    setPodBulkRunning(false);
    setActionMsg(
      failed
        ? `${actionMeta.label}: launched ${ok}/${samsungDevices.length} (${failed} failed)`
        : `${actionMeta.label}: launched for ${ok} gNB DUID(s)`
    );
  }

  if (loading && !devices.length) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-400">
            {activeTab === 'bmc'
              ? `vDU BMC status from Drive inventory · auto-refresh ${REFRESH_MS / 1000}s`
              : activeTab === 'subcloud'
                ? `Subcloud ping + RHOCP/WR precheck from vDU_List · auto-refresh ${REFRESH_MS / 1000}s`
                : activeTab === 'pods'
                  ? `Pods in cluster namespace (middleware namespace_name) · auto-refresh ${PODS_REFRESH_MS / 1000}s`
                  : `Samsung Atlas action failures · auto-refresh ${ISSUES_REFRESH_MS / 1000}s`}
          </p>
          {sheetId && (
            <p className="mt-0.5 font-mono text-[11px] text-gray-600">Sheet {sheetId}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              showSettings
                ? 'border-accent/50 bg-accent/10 text-accent-hover'
                : 'border-surface-border text-gray-400 hover:border-accent/40 hover:text-gray-200'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-accent/40 hover:text-accent-hover disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sync from Drive
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border border-white/5 bg-surface-glass p-1">
        {NETWORK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-accent/20 text-accent-hover'
                : 'text-gray-400 hover:bg-surface-overlay/60 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {syncNote && !error && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {syncNote}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <p>{error}</p>
          {isGoogleTokenError(error) && (
            <button
              type="button"
              onClick={beginGoogleReauth}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              Re-authenticate with Google
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {activeTab === 'pods' && podsError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {podsError}
        </div>
      )}

      {activeTab === 'issues' && issuesError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {issuesError}
        </div>
      )}

      {activeTab === 'subcloud' && hostAgent?.required && !hostAgent.ok && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Host network poller is not running — subcloud precheck will fail. Run{' '}
          <code className="rounded bg-black/20 px-1">.\scripts\start-network-host-poller.ps1</code>{' '}
          or restart the stack with{' '}
          <code className="rounded bg-black/20 px-1">.\scripts\start-windows.ps1</code>.
          {hostAgent.error && (
            <span className="mt-1 block text-xs text-amber-200/80">{hostAgent.error}</span>
          )}
        </div>
      )}

      {actionMsg && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {actionMsg}
        </div>
      )}

      {showSettings && !canWrite && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Network settings and stored credentials are only editable with full access.
        </div>
      )}

      {showSettings && canWrite && (
        <div className="space-y-4 rounded-xl border border-white/5 bg-surface-glass p-4 backdrop-blur-xl">
          <div>
            <h3 className="text-sm font-semibold text-white">Google Drive / Sheets</h3>
            <p className="mt-1 text-xs text-gray-500">
              vDU inventory sync uses the Workspace Google token. Subcloud IP, cluster name,
              cluster namespace (<code className="text-gray-400">namespace_name</code> from
              middleware), and parent controller are refreshed from Far-Edge middleware (Fuze SiteID)
              and written back to vDU_List when values change.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Re-authenticate if the token expired or Sync from Drive fails.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${
                  googleOk === true
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : googleOk === false
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-surface-border text-gray-500'
                }`}
              >
                {googleOk === true
                  ? `Connected${googleAccount ? ` · ${googleAccount}` : ''}`
                  : googleOk === false
                    ? 'Needs re-authentication'
                    : 'Status unknown'}
              </span>
              <button
                type="button"
                onClick={beginGoogleReauth}
                className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-accent/40 hover:text-accent-hover"
              >
                Re-authenticate with Google
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
            {googleError && (
              <p className="mt-2 text-xs text-amber-400/90">{googleError}</p>
            )}
            <p className="mt-2 text-[11px] text-gray-600">
              Redirect URI:{' '}
              <code className="rounded bg-black/20 px-1">
                {`${window.location.origin}/api/workspace/oauth/callback`}
              </code>
            </p>
          </div>

          <div className="border-t border-white/5 pt-4">
            <h3 className="text-sm font-semibold text-white">Atlas bearer token</h3>
            <p className="mt-1 text-xs text-gray-500">
              Used for Samsung precheck / upgrade / deploy / undeploy / rollback via Atlas. Paste a
              fresh token when the current one expires — no need to edit{' '}
              <code className="text-gray-400">.env</code> or restart the stack.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${
                  atlasBearerSet
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                }`}
              >
                {atlasBearerSet ? 'Token configured' : 'No bearer token set'}
              </span>
            </div>
            <form onSubmit={handleSaveAtlasBearer} className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block min-w-[16rem] flex-1">
                <span className="text-[11px] text-gray-500">New bearer token</span>
                <input
                  type="password"
                  value={atlasBearerInput}
                  onChange={(e) => setAtlasBearerInput(e.target.value)}
                  placeholder={atlasBearerSet ? '••••••••' : 'Paste Atlas bearer token'}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-surface-border bg-surface-overlay px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-accent/50"
                />
              </label>
              <button
                type="submit"
                disabled={savingAtlasBearer || !atlasBearerInput.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {savingAtlasBearer ? 'Saving…' : 'Save token'}
              </button>
            </form>
          </div>

          <div className="border-t border-white/5 pt-4">
            <h3 className="text-sm font-semibold text-white">BMC Redfish credentials</h3>
            <p className="mt-1 text-xs text-gray-500">
              Per-vendor shared credentials for Redfish health probes. Configure each vendor used in
              your vDU inventory.
            </p>
          </div>

          <div className="border-t border-white/5 pt-4">
            <h3 className="text-sm font-semibold text-white">Wind River subcloud SSH</h3>
            <p className="mt-1 text-xs text-gray-500">
              SSH credentials depend on the <span className="text-gray-400">Parent Central Controller</span>{' '}
              from vDU_List. Configure each controller used by Wind River subclouds. Sync from Drive
              to refresh the controller list.
            </p>
            {wrControllers.length === 0 ? (
              <p className="mt-2 text-xs text-amber-400">
                No Parent Central Controller rows yet — run Sync from Drive after vDU_List has that column.
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {wrControllers.map((ctrl) => (
                  <form
                    key={ctrl.controller}
                    onSubmit={(e) => handleSaveWrController(e, ctrl.controller)}
                    className="rounded-lg border border-white/5 bg-black/10 p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="font-mono text-xs font-medium text-violet-300">{ctrl.controller}</h4>
                      <span className="text-[11px] text-gray-600">
                        {ctrl.device_count} subcloud{ctrl.device_count === 1 ? '' : 's'}
                        {!ctrl.configured && (
                          <span className="ml-2 text-amber-400">Not configured</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3">
                      <label className="flex flex-col gap-1 text-xs text-gray-400">
                        Username
                        <input
                          value={wrControllerUsers[ctrl.controller] ?? ctrl.username}
                          onChange={(e) =>
                            setWrControllerUsers((prev) => ({
                              ...prev,
                              [ctrl.controller]: e.target.value,
                            }))
                          }
                          className="w-48 rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                          autoComplete="username"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-gray-400">
                        Password
                        <input
                          type="password"
                          value={wrControllerPasses[ctrl.controller] ?? ''}
                          onChange={(e) =>
                            setWrControllerPasses((prev) => ({
                              ...prev,
                              [ctrl.controller]: e.target.value,
                            }))
                          }
                          placeholder={ctrl.password_set ? '••••••••' : ''}
                          className="w-48 rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                          autoComplete="current-password"
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          type="submit"
                          disabled={
                            savingWrController === ctrl.controller ||
                            savingWrController != null ||
                            !(wrControllerUsers[ctrl.controller] ?? ctrl.username)
                          }
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                        >
                          {savingWrController === ctrl.controller ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </form>
                ))}
              </div>
            )}
            <div className="mt-4 border-t border-white/5 pt-4">
              <h4 className="text-xs font-semibold text-gray-300">Default fallback</h4>
              <p className="mt-1 text-[11px] text-gray-500">
                Used when no per-controller password is set. Password is write-only on save.
                Alternatively set <span className="font-mono text-gray-400">NETWORK_WR_SSH_KEY_PATH</span>{' '}
                on the host agent.
              </p>
              <form onSubmit={handleSaveWrSsh} className="mt-3 flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Username
                  <input
                    value={wrSshUser}
                    onChange={(e) => setWrSshUser(e.target.value)}
                    className="w-48 rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                    autoComplete="username"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Password
                  <input
                    type="password"
                    value={wrSshPass}
                    onChange={(e) => setWrSshPass(e.target.value)}
                    placeholder={wrSubcloud.password_set ? '••••••••' : ''}
                    className="w-48 rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                    autoComplete="current-password"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={savingWrSsh || !wrSshUser}
                    className="rounded-lg border border-white/10 bg-surface-overlay px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-surface-glass disabled:opacity-50"
                  >
                    {savingWrSsh ? 'Saving…' : 'Save default'}
                  </button>
                </div>
              </form>
              {wrSubcloud.key_path_set && (
                <p className="mt-2 text-[11px] text-emerald-400/90">SSH key path configured on host</p>
              )}
            </div>
          </div>

          <div className="border-t border-white/5 pt-4">
            <h3 className="text-sm font-semibold text-white">Custom precheck commands</h3>
            <p className="mt-1 text-xs text-gray-500">
              Optional extra checks run during Subcloud precheck. One per line:{' '}
              <span className="font-mono text-gray-400">Label: command | Platform</span>. Platform
              is <span className="font-mono">all</span>, <span className="font-mono">Wind River</span>
              , or <span className="font-mono">RHOCP</span>. RHOCP commands use kubectl (omit the
              kubectl prefix). WR commands run over SSH after openrc.
            </p>
            <p className="mt-1 text-[11px] text-gray-600">
              Logs saved under{' '}
              <code className="rounded bg-black/20 px-1">{precheckLogDir}/&lt;gNB DUID&gt;/</code>{' '}
              on each run.
            </p>
            <form onSubmit={handleSavePrecheckCustom} className="mt-3 space-y-2">
              <textarea
                value={precheckCustomCommands}
                onChange={(e) => setPrecheckCustomCommands(e.target.value)}
                rows={6}
                placeholder={
                  '# Example\nvDU pods: kubectl get pods -A | grep vdu | Wind River\nNon-running pods: get pods -A --field-selector=status.phase!=Running | RHOCP'
                }
                className="w-full max-w-2xl rounded-lg border border-surface-border bg-surface-overlay px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent/50"
              />
              <button
                type="submit"
                disabled={savingPrecheckCustom}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {savingPrecheckCustom ? 'Saving…' : 'Save custom commands'}
              </button>
            </form>
          </div>

          {VENDOR_CRED_FORMS.map((form) => (
            <VendorCredForm
              key={form.id}
              vendorId={form.id}
              title={form.title}
              hint={form.hint}
              username={credUsers[form.id]}
              password={credPasses[form.id]}
              configured={isVendorConfigured(vendors, form.id)}
              saving={savingCreds === form.id}
              anySaving={savingCreds != null}
              onUsernameChange={(value) =>
                setCredUsers((prev) => ({ ...prev, [form.id]: value }))
              }
              onPasswordChange={(value) =>
                setCredPasses((prev) => ({ ...prev, [form.id]: value }))
              }
              onSubmit={(e) => handleSaveCreds(e, form.id)}
            />
          ))}

          {credsMsg && <p className="text-xs text-gray-400">{credsMsg}</p>}
        </div>
      )}

      {activeTab === 'bmc' ? (
        <>
      <OwnerFilterBar
        value={ownerFilter}
        options={ownerOptions}
        onChange={setOwnerFilter}
        visibleCount={visibleDevices.length}
        totalCount={devices.length}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Devices</p>
          <p className="mt-1 text-2xl font-semibold text-white">{visibleDevices.length}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">BMC reachable</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">
            {upCount}
            <span className="text-sm font-normal text-gray-600"> / {visibleDevices.length}</span>
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Host power on</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">
            {hostPowerOn}
            <span className="text-sm font-normal text-gray-600">
              {' '}
              / {redfishOk || '—'}
            </span>
          </p>
          {hostPowerOff > 0 && (
            <p className="mt-0.5 text-[11px] text-red-400/80">{hostPowerOff} off</p>
          )}
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">BMC sessions</p>
          <p className="mt-1 text-2xl font-semibold text-sky-300 tabular-nums">{bmcSessionTotal}</p>
          <p className="mt-0.5 text-[11px] text-gray-600">
            across {bmcSessionMonitored} BMC{bmcSessionMonitored === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Redfish OK</p>
          <p className="mt-1 text-2xl font-semibold text-sky-300">
            {redfishOk}
            <span className="text-sm font-normal text-gray-600"> / {visibleDevices.length}</span>
          </p>
        </div>
      </div>

      {!devices.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <Server className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No devices yet</p>
          {canWrite && (
            <button
              type="button"
              onClick={handleSync}
              className="mt-2 text-sm text-accent-hover hover:underline"
            >
              Sync from Google Drive
            </button>
          )}
        </div>
      ) : !visibleDevices.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <Server className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No sites for owner “{ownerFilter}”</p>
          <button
            type="button"
            onClick={() => setOwnerFilter('')}
            className="mt-2 text-sm text-accent-hover hover:underline"
          >
            Clear owner filter
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[1140px] text-left text-sm">
            <thead className="border-b border-white/5 bg-surface-glass text-[11px] uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">gNB DUID</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">BMC IP</th>
                <th className="px-4 py-3 font-medium">Vendor / Model</th>
                <th className="px-4 py-3 font-medium">BMC Status</th>
                <th className="px-4 py-3 font-medium">Host Power</th>
                <th className="px-4 py-3 font-medium">Sessions</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Probed</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleDevices.map((d) => {
                const s = d.snapshot;
                const h = s?.health || {};
                const canReboot = Boolean(s?.reachable && s?.redfish_ok);
                const busy = rebootingId === d.id;
                const bmcBusy = bmcResettingId === d.id;
                const actionBusy = rebootingId != null || bmcResettingId != null;
                return (
                  <tr key={d.id} className="bg-surface-glass/40 hover:bg-surface-overlay/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{d.cluster_id}</div>
                      {d.application && (
                        <div className="text-[11px] text-gray-500">{d.application}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{d.owner || '—'}</td>
                    <td className="px-4 py-3">
                      <BmcIpLink ip={d.bmc_ip} vendor={d.vendor} />
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      <div>{d.vendor || '—'}</div>
                      <div className="text-[11px] text-gray-500">
                        {[d.model_type, d.model].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                            !s
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                              : s.reachable
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-red-500/40 bg-red-500/10 text-red-300'
                          }`}
                        >
                          {!s ? 'Pending' : s.reachable ? 'Up' : 'Down'}
                        </span>
                        <span
                          className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                            s?.redfish_ok
                              ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                              : 'border-surface-border text-gray-500'
                          }`}
                        >
                          Redfish {s?.redfish_ok ? 'OK' : '—'}
                        </span>
                      </div>
                      {s?.error && (
                        <p className="mt-1 max-w-[180px] truncate text-[10px] text-red-400/80" title={s.error}>
                          {s.error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <HostPowerBadge power={h.system?.power} redfishOk={s?.redfish_ok} />
                    </td>
                    <td className="px-4 py-3">
                      <BmcSessionsBadge sessions={h.sessions} redfishOk={s?.redfish_ok} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-300">
                      {s?.latency_ms != null ? `${s.latency_ms} ms` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <HealthBadge
                          label="Sys"
                          health={h.system?.health}
                          detail={systemHealthDetail(h, d)}
                        />
                        <HealthBadge
                          label="CPU"
                          health={h.processor?.health}
                          detail={processorHealthDetail(h)}
                        />
                        <HealthBadge
                          label="Mem"
                          health={h.memory?.health}
                          detail={formatMemoryDetail(h.memory?.size_gib)}
                        />
                        <HealthBadge label="Sto" health={h.storage?.health} />
                        <HealthBadge
                          label="PSU"
                          health={h.power_supply?.health}
                          detail={powerSupplyHealthDetail(h)}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatProbed(s?.probed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {!canWrite && <span className="text-[11px] text-gray-600">—</span>}
                        {canWrite && (
                        <button
                          type="button"
                          onClick={() => handleReboot(d)}
                          disabled={!canReboot || actionBusy}
                          title={
                            canReboot
                              ? `PowerCycle host ${d.cluster_id} via Redfish (ComputerSystem.Reset)`
                              : 'BMC must be Up with Redfish OK'
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Power className={`h-3.5 w-3.5 ${busy ? 'animate-pulse' : ''}`} />
                          {busy ? 'Rebooting…' : 'Host Reboot'}
                        </button>
                        )}
                        {canWrite && (
                        <button
                          type="button"
                          onClick={() => handleBmcReset(d)}
                          disabled={!canReboot || actionBusy}
                          title={
                            canReboot
                              ? (d.vendor || '').toUpperCase().includes('ZT')
                                ? `GracefulRestart BMC ${d.cluster_id} via ipmitool mc reset warm`
                                : `GracefulRestart BMC ${d.cluster_id} via Redfish (Manager.Reset)`
                              : 'BMC must be Up with Redfish OK'
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${bmcBusy ? 'animate-spin' : ''}`} />
                          {bmcBusy ? 'Resetting…' : 'BMC Reset'}
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      ) : activeTab === 'subcloud' ? (
        <>
      <OwnerFilterBar
        value={ownerFilter}
        options={ownerOptions}
        onChange={setOwnerFilter}
        visibleCount={visibleDevices.length}
        totalCount={devices.length}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Subcloud IPs</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {subcloudDevices.length}
            <span className="text-sm font-normal text-gray-600"> / {visibleDevices.length}</span>
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Ping up</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">
            {subcloudUp}
            <span className="text-sm font-normal text-gray-600">
              {' '}
              / {subcloudDevices.length || '—'}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Avg latency</p>
          <p className="mt-1 text-2xl font-semibold text-violet-300">
            {subcloudAvgLatency != null ? `${subcloudAvgLatency} ms` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Precheck</p>
          <p className="mt-1 text-lg font-semibold text-white">
            <span className="text-emerald-300">{precheckPass}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-amber-200">{precheckWarn}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-red-300">{precheckFail}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-gray-600">pass / warn / fail</p>
        </div>
      </div>

      {!devices.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <Activity className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No devices yet</p>
          {canWrite && (
            <button
              type="button"
              onClick={handleSync}
              className="mt-2 text-sm text-accent-hover hover:underline"
            >
              Sync from Google Drive
            </button>
          )}
        </div>
      ) : !visibleDevices.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <Activity className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No sites for owner “{ownerFilter}”</p>
          <button
            type="button"
            onClick={() => setOwnerFilter('')}
            className="mt-2 text-sm text-accent-hover hover:underline"
          >
            Clear owner filter
          </button>
        </div>
      ) : !subcloudDevices.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <Activity className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No Subcloud IP column values in vDU_List</p>
          <p className="mt-1 text-xs text-gray-600">
            Add a <span className="font-mono text-gray-500">Subcloud IP</span> column to the sheet, then
            Sync from Drive.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-white/5 bg-surface-glass text-[11px] uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">gNB DUID</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Subcloud IP</th>
                <th className="px-4 py-3 font-medium">OS / Cluster</th>
                <th className="px-4 py-3 font-medium">Parent CC</th>
                <th className="px-4 py-3 font-medium">Ping</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Precheck</th>
                <th className="px-4 py-3 font-medium">Checked</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleDevices.map((d) => {
                const ip = d.subcloud_ip?.trim();
                if (!ip) return null;
                const sc = d.subcloud_snapshot;
                const pc = d.precheck_snapshot;
                const busy = precheckingId === d.id;
                const expanded = expandedPrecheckId === d.id;
                const canPrecheck = Boolean(sc?.reachable);
                return (
                  <Fragment key={d.id}>
                    <tr className="bg-surface-glass/40 hover:bg-surface-overlay/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{d.cluster_id}</div>
                        {d.application && (
                          <div className="text-[11px] text-gray-500">{d.application}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{d.owner || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-violet-300">{ip}</td>
                      <td className="px-4 py-3 text-gray-300">
                        <div>{d.os || '—'}</div>
                        <div className="font-mono text-[11px] text-gray-500">
                          {d.cluster_name || '—'}
                        </div>
                        {d.cluster_namespace && (
                          <div
                            className="mt-0.5 max-w-[220px] truncate font-mono text-[10px] text-violet-400/90"
                            title={d.cluster_namespace}
                          >
                            {d.cluster_namespace}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-400">
                        {d.parent_controller || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex w-fit rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                            !sc
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                              : sc.reachable
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-red-500/40 bg-red-500/10 text-red-300'
                          }`}
                        >
                          {!sc ? 'Pending' : sc.reachable ? 'Up' : 'Down'}
                        </span>
                        {sc?.error && (
                          <p className="mt-1 max-w-[200px] truncate text-[10px] text-red-400/80" title={sc.error}>
                            {sc.error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-300">
                        {sc?.latency_ms != null ? `${sc.latency_ms} ms` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpandedPrecheckId(expanded ? null : d.id)}
                          disabled={!pc}
                          className="text-left disabled:cursor-default"
                          title={pc?.summary || 'Run precheck to see details'}
                        >
                          <PrecheckBadge status={pc?.status} />
                          {pc?.platform && (
                            <p className="mt-0.5 text-[10px] text-gray-600">{pc.platform}</p>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {formatProbed(pc?.checked_at || sc?.probed_at)}
                      </td>
                      <td className="px-4 py-3">
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => handlePrecheck(d)}
                            disabled={!canPrecheck || busy || precheckingId != null}
                            title={
                              canPrecheck
                                ? `Run subcloud precheck for ${d.cluster_id}`
                                : 'Subcloud must be reachable (ping Up)'
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-medium text-sky-200 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ClipboardCheck className={`h-3.5 w-3.5 ${busy ? 'animate-pulse' : ''}`} />
                            {busy ? 'Checking…' : 'Precheck'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                    {expanded && pc && (
                      <tr key={`${d.id}-detail`} className="bg-surface-overlay/40">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                            <p className="text-xs font-medium text-gray-300">
                              {pc.summary || 'Precheck results'}
                            </p>
                            {pc.log_file && (
                              <p className="mt-1 font-mono text-[11px] text-sky-300/90">
                                Log: {pc.log_file}
                              </p>
                            )}
                            {pc.error && (
                              <p className="mt-1 text-xs text-red-400">{pc.error}</p>
                            )}
                            <div className="mt-2 max-w-2xl">
                              {pc.checks.map((check) => (
                                <PrecheckCheckRow key={check.id} check={check} />
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      ) : activeTab === 'pods' ? (
        <>
      {hostAgent?.required && !hostAgent.ok && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Host network poller is not running — pod listing may fail for RHOCP/WR kubectl. Run{' '}
          <code className="rounded bg-black/20 px-1">.\scripts\start-network-host-poller.ps1</code>.
          {hostAgent.error && (
            <span className="mt-1 block text-xs text-amber-200/80">{hostAgent.error}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Namespaces</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {namespaceDevices.length}
            <span className="text-sm font-normal text-gray-600"> / {devices.length}</span>
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Running pods</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">{podsRunningTotal}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Not running</p>
          <p className="mt-1 text-2xl font-semibold text-amber-200">{podsNotRunningTotal}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Fetch errors</p>
          <p className="mt-1 text-2xl font-semibold text-red-300">{podsClusterErrors}</p>
          {podsFetchedAt && (
            <p className="mt-0.5 text-[10px] text-gray-600">
              Updated {formatProbed(podsFetchedAt)}
            </p>
          )}
        </div>
      </div>

      {podsLoading && !clusterPods.length ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : !devices.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <Boxes className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No devices yet</p>
          {canWrite && (
            <button
              type="button"
              onClick={handleSync}
              className="mt-2 text-sm text-accent-hover hover:underline"
            >
              Sync from Google Drive
            </button>
          )}
        </div>
      ) : !namespaceDevices.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <Boxes className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No cluster namespace values yet</p>
          <p className="mt-1 max-w-md text-center text-xs text-gray-600">
            Run Sync from Drive — cluster namespace is filled from middleware{' '}
            <span className="font-mono text-gray-500">namespace_name</span> via Fuze SiteID.
          </p>
        </div>
      ) : (
        <>
        <div className="rounded-xl border border-white/5 bg-surface-glass">
          <button
            type="button"
            onClick={() => setPodFiltersOpen((open) => !open)}
            className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-200">
              <Filter className="h-4 w-4 text-accent" />
              Filters
              {podsFiltersApplied && (
                <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-hover">
                  Active
                </span>
              )}
            </span>
            <span className="text-xs text-gray-500">
              Showing {filteredPodDevices.length} of {namespaceDevices.length} gNB DUID
              {namespaceDevices.length === 1 ? '' : 's'}
              {selectedPodDeviceIds.size > 0 && (
                <span className="ml-2 text-gray-600">· {selectedPodDeviceIds.size} selected</span>
              )}
            </span>
          </button>
          {podFiltersOpen && (
            <div className="border-t border-white/5 px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs text-gray-400 sm:col-span-2 lg:col-span-2">
                  Search gNB DUID, cluster, namespace…
                  <input
                    type="search"
                    value={podFilters.search}
                    onChange={(e) =>
                      setPodFilters((prev) => ({ ...prev, search: e.target.value }))
                    }
                    placeholder="e.g. 29991573162 or welktx"
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Owner
                  <select
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value)}
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="">All owners</option>
                    {ownerOptions.map((owner) => (
                      <option key={owner} value={owner}>
                        {owner}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Application
                  <select
                    value={podFilters.application}
                    onChange={(e) =>
                      setPodFilters((prev) => ({ ...prev, application: e.target.value }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="">All</option>
                    {podFilterOptions.applications.map((app) => (
                      <option key={app} value={app}>
                        {app}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Platform
                  <select
                    value={podFilters.platform}
                    onChange={(e) =>
                      setPodFilters((prev) => ({ ...prev, platform: e.target.value }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="">All</option>
                    {podFilterOptions.platforms.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Parent CC
                  <select
                    value={podFilters.parentController}
                    onChange={(e) =>
                      setPodFilters((prev) => ({ ...prev, parentController: e.target.value }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="">All</option>
                    {podFilterOptions.parentControllers.map((controller) => (
                      <option key={controller} value={controller}>
                        {controller}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Pod health
                  <select
                    value={podFilters.podHealth}
                    onChange={(e) =>
                      setPodFilters((prev) => ({
                        ...prev,
                        podHealth: e.target.value as PodHealthFilter,
                      }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="all">All</option>
                    <option value="healthy">All pods running</option>
                    <option value="issues">Has not-running pods</option>
                    <option value="errors">Fetch error</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Atlas precheck
                  <select
                    value={podFilters.atlasPrecheck}
                    onChange={(e) =>
                      setPodFilters((prev) => ({
                        ...prev,
                        atlasPrecheck: e.target.value as PodAtlasStatusFilter,
                      }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="any">Any</option>
                    <option value="none">None</option>
                    <option value="active">Running / waiting</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Atlas upgrade
                  <select
                    value={podFilters.atlasUpgrade}
                    onChange={(e) =>
                      setPodFilters((prev) => ({
                        ...prev,
                        atlasUpgrade: e.target.value as PodAtlasStatusFilter,
                      }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="any">Any</option>
                    <option value="none">None</option>
                    <option value="active">Running / waiting</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Atlas rollback
                  <select
                    value={podFilters.atlasRollback}
                    onChange={(e) =>
                      setPodFilters((prev) => ({
                        ...prev,
                        atlasRollback: e.target.value as PodAtlasStatusFilter,
                      }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="any">Any</option>
                    <option value="none">None</option>
                    <option value="active">Running / waiting</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Atlas undeployment
                  <select
                    value={podFilters.atlasUndeployment}
                    onChange={(e) =>
                      setPodFilters((prev) => ({
                        ...prev,
                        atlasUndeployment: e.target.value as PodAtlasStatusFilter,
                      }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="any">Any</option>
                    <option value="none">None</option>
                    <option value="active">Running / waiting</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Atlas deployment
                  <select
                    value={podFilters.atlasDeployment}
                    onChange={(e) =>
                      setPodFilters((prev) => ({
                        ...prev,
                        atlasDeployment: e.target.value as PodAtlasStatusFilter,
                      }))
                    }
                    className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
                  >
                    <option value="any">Any</option>
                    <option value="none">None</option>
                    <option value="active">Running / waiting</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => selectVisiblePodDevices(filteredPodDeviceIds)}
                  disabled={!filteredPodDeviceIds.length}
                  className="rounded-lg border border-white/10 bg-surface-overlay px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-surface-glass disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select visible ({filteredPodDeviceIds.length})
                </button>
                {podsFiltersApplied && (
                  <button
                    type="button"
                    onClick={resetPodFilters}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
                  >
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  disabled
                  title="Generate a report for selected gNB DUIDs (coming soon)"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/5 px-3 py-1.5 text-xs font-medium text-gray-600"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Report (soon)
                </button>
                <span className="text-[11px] text-gray-600">
                  Filters apply to the table below. Use checkboxes + actions for bulk ops; reports
                  will use the same selection.
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            Action
            <select
              value={podBulkAction}
              onChange={(e) => setPodBulkAction(e.target.value as PodBulkAction)}
              className="min-w-[180px] rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
            >
              {POD_BULK_ACTIONS.map((action) => (
                <option key={action.id} value={action.id}>
                  {action.label}
                </option>
              ))}
            </select>
          </label>
          {atlasConfigured && (
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              SW TAG
              <select
                value={selectedSwTag}
                onChange={(e) => setSelectedSwTag(e.target.value)}
                title="Software version from vDU_List → Application SW (used for Samsung precheck/upgrade/rollback/deploy/undeploy)"
                className="min-w-[160px] rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
              >
                {!swTags.length ? (
                  <option value="">No SW TAGs — Sync from Drive</option>
                ) : (
                  <>
                    <option value="">Select SW TAG…</option>
                    {swTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
          )}
          {atlasConfigured && (
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              CIQ source
              <select
                value={ciqSource}
                onChange={(e) => setCiqSource(e.target.value)}
                title="ciqSource sent to Atlas when launching a Samsung deployment"
                className="min-w-[160px] rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
              >
                {ciqSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => runPodBulkAction()}
            disabled={podBulkDisabled}
            title={
              selectedPodDeviceIds.size === 0
                ? 'Select one or more gNB DUIDs below'
                : podBulkActionMeta?.requiresMiddleware && !middlewareConfigured
                  ? 'Set NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME/PASSWORD in .env'
                  : podBulkActionMeta?.requiresMiddleware && podBulkDisabled
                    ? 'Selected gNB DUIDs must have a cluster name'
                    : podBulkActionMeta?.samsungOnly && podBulkDisabled
                      ? 'Selected gNB DUIDs must include Samsung application devices'
                      : undefined
            }
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent-hover transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className={`h-4 w-4 ${podBulkRunning ? 'animate-pulse' : ''}`} />
            {podBulkRunning ? 'Running…' : 'Run'}
          </button>
          <span className="mt-5 text-xs text-gray-500">
            {selectedPodDeviceIds.size} selected
            {podBulkActionMeta?.samsungOnly && selectedPodDeviceIds.size > 0 && (
              <span className="ml-1 text-gray-600">· Samsung only</span>
            )}
            {podBulkActionMeta?.requiresMiddleware && selectedPodDeviceIds.size > 0 && (
              <span className="ml-1 text-gray-600">· uses cluster name</span>
            )}
          </span>
          {!middlewareConfigured && podBulkActionMeta?.requiresMiddleware && (
            <span className="mt-5 text-xs text-amber-400">
              Middleware not configured — set NETWORK_SUBCLOUD_MIDDLEWARE_USERNAME/PASSWORD in .env
            </span>
          )}
          {!atlasConfigured && podBulkActionMeta?.samsungOnly && (
            <span className="mt-5 text-xs text-amber-400">
              Atlas not configured — Samsung actions disabled
            </span>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-white/5 bg-surface-glass text-[11px] uppercase tracking-wider text-gray-600">
              <tr>
                <th className="w-10 px-3 py-3 font-medium">
                  <input
                    type="checkbox"
                    checked={allPodsSelected}
                    onChange={() => toggleAllPodDeviceSelection(filteredPodDeviceIds)}
                    aria-label="Select all visible gNB DUIDs"
                    className="h-3.5 w-3.5 rounded border-surface-border bg-surface-overlay accent-accent"
                  />
                </th>
                <th className="px-4 py-3 font-medium">gNB DUID</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Namespace</th>
                <th className="px-4 py-3 font-medium">Platform</th>
                <th className="px-4 py-3 font-medium">Software</th>
                <th className="px-4 py-3 font-medium">Running</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Pods</th>
                <th className="px-4 py-3 font-medium">Atlas precheck</th>
                <th className="px-4 py-3 font-medium">Atlas deploy</th>
                <th className="px-4 py-3 font-medium">Atlas upgrade</th>
                <th className="px-4 py-3 font-medium">Atlas rollback</th>
                <th className="px-4 py-3 font-medium">Atlas undeploy</th>
                <th className="px-4 py-3 font-medium">Fetched</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredPodDevices.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-sm text-gray-500">
                    No gNB DUIDs match the current filters.
                    {podsFiltersApplied && (
                      <button
                        type="button"
                        onClick={resetPodFilters}
                        className="ml-2 text-accent-hover hover:underline"
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
              filteredPodDevices.map((d) => {
                const row =
                  clusterPods.find((c) => c.device_id === d.id) || {
                    device_id: d.id,
                    cluster_id: d.cluster_id,
                    cluster_name: d.cluster_name,
                    cluster_namespace: d.cluster_namespace || '',
                    platform: d.os,
                    total: 0,
                    running: 0,
                    not_running: 0,
                    pods: [],
                    fetched_at: '',
                  };
                const expanded = expandedPodClusterIds.has(d.id);
                const busy = refreshingPodIds.has(d.id);
                const samsungBusy = samsungPrecheckingId === d.id;
                const samsungUpgradeBusy = samsungUpgradingId === d.id;
                const samsungRollbackBusy = samsungRollbackingId === d.id;
                const samsungUndeploymentBusy = samsungUndeployingId === d.id;
                const samsungDeploymentBusy = samsungDeployingId === d.id;
                const samsung = isSamsungDevice(d);
                const samsungRun = samsungPrecheckRuns[d.id];
                const samsungUpgradeRun = samsungUpgradeRuns[d.id];
                const samsungRollbackRun = samsungRollbackRuns[d.id];
                const samsungUndeploymentRun = samsungUndeploymentRuns[d.id];
                const samsungDeploymentRun = samsungDeploymentRuns[d.id];
                const samsungExpanded = expandedSamsungPrecheckId === d.id;
                const samsungUpgradeExpanded = expandedSamsungUpgradeId === d.id;
                const samsungRollbackExpanded = expandedSamsungRollbackId === d.id;
                const samsungUndeploymentExpanded = expandedSamsungUndeploymentId === d.id;
                const samsungDeploymentExpanded = expandedSamsungDeploymentId === d.id;
                const connectionDetailsExpanded = expandedConnectionDetailsIds.has(d.id);
                const connectionDetails = connectionDetailsByDevice[d.id];
                const selected = selectedPodDeviceIds.has(d.id);
                const allRunning = row.total > 0 && row.not_running === 0 && !row.error;
                const hasIssue = Boolean(row.error) || row.not_running > 0;
                return (
                  <Fragment key={d.id}>
                    <tr className={`bg-surface-glass/40 hover:bg-surface-overlay/60 ${selected ? 'ring-1 ring-inset ring-accent/30' : ''}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => togglePodDeviceSelection(d.id)}
                          aria-label={`Select gNB DUID ${d.cluster_id}`}
                          className="h-3.5 w-3.5 rounded border-surface-border bg-surface-overlay accent-accent"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{d.cluster_id}</div>
                        {d.cluster_name && (
                          <div className="font-mono text-[11px] text-gray-500">{d.cluster_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{d.owner || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-violet-300">
                        {d.cluster_namespace}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{row.platform || d.os || '—'}</td>
                      <td className="px-4 py-3">
                        {row.software_version ? (
                          <div>
                            <span
                              className="font-mono text-xs text-sky-300"
                              title={
                                [
                                  row.build_info?.fields
                                    ? Object.entries(row.build_info.fields)
                                        .map(([k, v]) => `${k}=${v}`)
                                        .join('\n')
                                    : row.software_version,
                                  d.samsung_software_tracker?.current_release
                                    ? `Atlas release: ${d.samsung_software_tracker.current_release}`
                                    : null,
                                  d.samsung_software_tracker?.rollback_release
                                    ? `Rollback baseline: ${d.samsung_software_tracker.rollback_release}${d.samsung_software_tracker.rollback_display ? ` (${d.samsung_software_tracker.rollback_display})` : ''}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join('\n\n')
                              }
                            >
                              {row.software_version}
                            </span>
                            {samsung && d.samsung_software_tracker?.rollback_release && (
                              <p className="mt-0.5 font-mono text-[10px] text-rose-300/80">
                                Rollback: {d.samsung_software_tracker.rollback_release}
                              </p>
                            )}
                          </div>
                        ) : row.build_info?.error ? (
                          <span
                            className="text-[11px] text-amber-400/90"
                            title={row.build_info.error}
                          >
                            —
                          </span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-emerald-300">
                        {row.error ? '—' : row.running}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-300">
                        {row.error ? '—' : row.total}
                      </td>
                      <td className="px-4 py-3">
                        {row.error ? (
                          <span
                            className="inline-flex max-w-[220px] truncate rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-300"
                            title={row.error}
                          >
                            Error
                          </span>
                        ) : row.total === 0 ? (
                          <span className="inline-flex rounded border border-surface-border px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                            Empty
                          </span>
                        ) : allRunning ? (
                          <span className="inline-flex rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
                            All running
                          </span>
                        ) : hasIssue ? (
                          <span className="inline-flex rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
                            {row.not_running} not running
                          </span>
                        ) : (
                          <span className="inline-flex rounded border border-surface-border px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                            —
                          </span>
                        )}
                        {row.error && (
                          <p className="mt-1 max-w-[240px] truncate text-[10px] text-red-400/80" title={row.error}>
                            {row.error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {samsung ? (
                          <SamsungAtlasStatusCell
                            run={samsungRun}
                            busy={samsungBusy}
                            operation="precheck"
                            onToggle={() =>
                              setExpandedSamsungPrecheckId(samsungExpanded ? null : d.id)
                            }
                          />
                        ) : (
                          <span className="text-[11px] text-gray-600">n/a</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {samsung ? (
                          <SamsungAtlasStatusCell
                            run={samsungDeploymentRun}
                            busy={samsungDeploymentBusy}
                            operation="deployment"
                            onToggle={() =>
                              setExpandedSamsungDeploymentId(
                                samsungDeploymentExpanded ? null : d.id
                              )
                            }
                          />
                        ) : (
                          <span className="text-[11px] text-gray-600">n/a</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {samsung ? (
                          <SamsungAtlasStatusCell
                            run={samsungUpgradeRun}
                            busy={samsungUpgradeBusy}
                            operation="upgrade"
                            onToggle={() =>
                              setExpandedSamsungUpgradeId(samsungUpgradeExpanded ? null : d.id)
                            }
                          />
                        ) : (
                          <span className="text-[11px] text-gray-600">n/a</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {samsung ? (
                          <SamsungAtlasStatusCell
                            run={samsungRollbackRun}
                            busy={samsungRollbackBusy}
                            operation="rollback"
                            onToggle={() =>
                              setExpandedSamsungRollbackId(samsungRollbackExpanded ? null : d.id)
                            }
                          />
                        ) : (
                          <span className="text-[11px] text-gray-600">n/a</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {samsung ? (
                          <SamsungAtlasStatusCell
                            run={samsungUndeploymentRun}
                            busy={samsungUndeploymentBusy}
                            operation="undeployment"
                            onToggle={() =>
                              setExpandedSamsungUndeploymentId(
                                samsungUndeploymentExpanded ? null : d.id
                              )
                            }
                          />
                        ) : (
                          <span className="text-[11px] text-gray-600">n/a</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {busy ? (
                          <span className="inline-flex items-center gap-1 text-sky-300">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            Refreshing…
                          </span>
                        ) : row.fetched_at ? (
                          formatProbed(row.fetched_at)
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    {samsungExpanded && samsungRun && (
                      <tr key={`${d.id}-samsung-precheck`} className="bg-surface-overlay/40">
                        <td colSpan={15} className="px-4 py-3">
                          <SamsungAtlasPanel run={samsungRun} operation="precheck" />
                        </td>
                      </tr>
                    )}
                    {samsungUpgradeExpanded && samsungUpgradeRun && (
                      <tr key={`${d.id}-samsung-upgrade`} className="bg-surface-overlay/40">
                        <td colSpan={15} className="px-4 py-3">
                          <SamsungAtlasPanel
                            run={samsungUpgradeRun}
                            operation="upgrade"
                            cancelBusy={samsungCancellingId === d.id}
                            onCancel={() => handleSamsungAtlasCancel(d, 'upgrade')}
                          />
                        </td>
                      </tr>
                    )}
                    {samsungRollbackExpanded && samsungRollbackRun && (
                      <tr key={`${d.id}-samsung-rollback`} className="bg-surface-overlay/40">
                        <td colSpan={15} className="px-4 py-3">
                          <SamsungAtlasPanel
                            run={samsungRollbackRun}
                            operation="rollback"
                            cancelBusy={samsungCancellingId === d.id}
                            onCancel={() => handleSamsungAtlasCancel(d, 'rollback')}
                          />
                        </td>
                      </tr>
                    )}
                    {samsungUndeploymentExpanded && samsungUndeploymentRun && (
                      <tr key={`${d.id}-samsung-undeployment`} className="bg-surface-overlay/40">
                        <td colSpan={15} className="px-4 py-3">
                          <SamsungAtlasPanel
                            run={samsungUndeploymentRun}
                            operation="undeployment"
                            cancelBusy={samsungCancellingId === d.id}
                            onCancel={() => handleSamsungAtlasCancel(d, 'undeployment')}
                          />
                        </td>
                      </tr>
                    )}
                    {samsungDeploymentExpanded && samsungDeploymentRun && (
                      <tr key={`${d.id}-samsung-deployment`} className="bg-surface-overlay/40">
                        <td colSpan={15} className="px-4 py-3">
                          <SamsungAtlasPanel
                            run={samsungDeploymentRun}
                            operation="deployment"
                            cancelBusy={samsungCancellingId === d.id}
                            onCancel={() => handleSamsungAtlasCancel(d, 'deployment')}
                          />
                        </td>
                      </tr>
                    )}
                    {connectionDetailsExpanded && connectionDetails && (
                      <tr key={`${d.id}-connection-details`} className="bg-surface-overlay/40">
                        <td colSpan={15} className="px-4 py-3">
                          <ConnectionDetailsPanel details={connectionDetails} />
                        </td>
                      </tr>
                    )}
                    {expanded && (row.pods.length > 0 || row.build_info?.fields) && (
                      <tr key={`${d.id}-pods`} className="bg-surface-overlay/40">
                        <td colSpan={15} className="px-4 py-3">
                          {row.build_info?.fields && Object.keys(row.build_info.fields).length > 0 && (
                            <div className="mb-3 rounded-lg border border-white/5 bg-black/20 p-3">
                              <p className="text-xs font-medium text-gray-300">
                                Software build info
                                {row.build_info.pod && (
                                  <span className="ml-2 font-mono text-[10px] font-normal text-gray-500">
                                    from {row.build_info.pod}
                                  </span>
                                )}
                              </p>
                              {row.build_info.files?.map((file) => (
                                <p
                                  key={file.path}
                                  className="mt-1 font-mono text-[10px] text-gray-600"
                                >
                                  {file.path}
                                </p>
                              ))}
                              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                                {Object.entries(row.build_info.fields).map(([key, value]) => (
                                  <div key={key} className="flex gap-2 text-xs">
                                    <dt className="shrink-0 font-mono text-gray-500">{key}</dt>
                                    <dd className="font-mono text-gray-200">{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}
                          {row.build_info?.error && !row.build_info?.fields && (
                            <p className="mb-3 text-xs text-amber-400/90">{row.build_info.error}</p>
                          )}
                          {row.pods.length > 0 && (
                          <div className="overflow-x-auto rounded-lg border border-white/5 bg-black/20">
                            <table className="w-full min-w-[720px] text-left text-xs">
                              <thead className="border-b border-white/5 text-[10px] uppercase tracking-wider text-gray-600">
                                <tr>
                                  <th className="px-3 py-2 font-medium">Pod</th>
                                  <th className="px-3 py-2 font-medium">Phase</th>
                                  <th className="px-3 py-2 font-medium">Ready</th>
                                  <th className="px-3 py-2 font-medium">Restarts</th>
                                  <th className="px-3 py-2 font-medium">Age</th>
                                  <th className="px-3 py-2 font-medium">Node</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {row.pods.map((pod) => (
                                  <tr key={pod.name}>
                                    <td className="px-3 py-2 font-mono text-gray-200">{pod.name}</td>
                                    <td className="px-3 py-2">
                                      <span
                                        className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${podPhaseClass(pod.phase)}`}
                                        title={pod.reason || undefined}
                                      >
                                        {pod.phase}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 tabular-nums text-gray-300">{pod.ready}</td>
                                    <td className="px-3 py-2 tabular-nums text-gray-300">{pod.restarts}</td>
                                    <td className="px-3 py-2 text-gray-400">{formatPodAge(pod.started_at)}</td>
                                    <td className="px-3 py-2 font-mono text-[10px] text-gray-500">
                                      {pod.node || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
              )}
            </tbody>
          </table>
        </div>
        </>
      )}
        </>
      ) : (
        <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Total issues</p>
          <p className="mt-1 text-2xl font-semibold text-white">{issuesTotal}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Open</p>
          <p className="mt-1 text-2xl font-semibold text-amber-300">
            {samsungIssues.filter((i) => !i.resolved_date).length}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface-glass px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-600">Resolved</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">
            {samsungIssues.filter((i) => Boolean(i.resolved_date)).length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/5 bg-surface-glass p-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] text-gray-500">
          Search
          <input
            type="search"
            value={issuesSearch}
            onChange={(e) => setIssuesSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setIssuesQuery(issuesSearch);
              }
            }}
            placeholder="gNB DUID, description, job id/name…"
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-gray-500">
          Operation
          <select
            value={issuesOperation}
            onChange={(e) =>
              setIssuesOperation(e.target.value as '' | SamsungAtlasOperation)
            }
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-200"
          >
            {ISSUE_OPERATION_FILTERS.map((opt) => (
              <option key={opt.id || 'all'} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={issuesOpenOnly}
            onChange={(e) => setIssuesOpenOnly(e.target.checked)}
            className="rounded border-white/20"
          />
          Open only
        </label>
        <button
          type="button"
          onClick={() => {
            setIssuesQuery(issuesSearch);
            void loadSamsungIssues(false, issuesSearch);
          }}
          disabled={issuesLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-surface-overlay px-3 py-2 text-xs font-medium text-gray-200 hover:bg-surface-overlay/80 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${issuesLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {issuesLoading && !samsungIssues.length ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : !samsungIssues.length ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 text-gray-500">
          <FileText className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No Samsung issues logged yet</p>
          <p className="mt-1 max-w-md text-center text-xs text-gray-600">
            Failures from Pods Samsung actions (precheck, deploy, upgrade, rollback, undeploy) are
            recorded here automatically.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/5 bg-surface-glass">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/5 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-3 font-medium">Issue name</th>
                <th className="px-3 py-3 font-medium">gNB DUID</th>
                <th className="px-3 py-3 font-medium">Site type</th>
                <th className="min-w-[220px] px-3 py-3 font-medium">Issue Description</th>
                <th className="min-w-[180px] px-3 py-3 font-medium">Job name</th>
                <th className="px-3 py-3 font-medium">ATLAS Job ID</th>
                <th className="px-3 py-3 font-medium">Issue date</th>
                <th className="px-3 py-3 font-medium">Resolved date</th>
                <th className="min-w-[200px] px-3 py-3 font-medium">Resolution details</th>
                <th className="px-3 py-3 font-medium">User reporter</th>
                {canWrite && <th className="px-3 py-3 font-medium"> </th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {samsungIssues.map((issue) => {
                const draft = issuesDrafts[issue.id] || {
                  resolved_date: toDateInputValue(issue.resolved_date),
                  resolution_details: issue.resolution_details || '',
                };
                const saving = issuesSavingId === issue.id;
                return (
                  <tr key={issue.id} className="align-top hover:bg-surface-overlay/40">
                    <td className="px-3 py-3 text-gray-200">{issue.issue_name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-200">
                      {issue.cluster_id}
                    </td>
                    <td className="px-3 py-3 text-gray-300">{issue.site_type || '—'}</td>
                    <td className="px-3 py-3">
                      <p
                        className="max-w-md whitespace-pre-wrap break-words text-xs text-gray-300"
                        title={issue.issue_description}
                      >
                        {issue.issue_description || '—'}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p
                        className="max-w-xs break-words text-xs text-violet-200/90"
                        title={issue.atlas_job_name || undefined}
                      >
                        {issue.atlas_job_name || '—'}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-300">
                      {issue.atlas_job_id || '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400">
                      {formatIssueDateTime(issue.issue_date)}
                    </td>
                    <td className="px-3 py-3">
                      {canWrite ? (
                        <input
                          type="date"
                          value={draft.resolved_date}
                          onChange={(e) =>
                            setIssuesDrafts((prev) => ({
                              ...prev,
                              [issue.id]: {
                                ...draft,
                                resolved_date: e.target.value,
                              },
                            }))
                          }
                          className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-gray-200"
                        />
                      ) : (
                        <span className="text-xs text-gray-400">
                          {issue.resolved_date
                            ? formatIssueDateTime(issue.resolved_date)
                            : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {canWrite ? (
                        <textarea
                          value={draft.resolution_details}
                          onChange={(e) =>
                            setIssuesDrafts((prev) => ({
                              ...prev,
                              [issue.id]: {
                                ...draft,
                                resolution_details: e.target.value,
                              },
                            }))
                          }
                          rows={2}
                          placeholder="Enter resolution details…"
                          className="w-full min-w-[180px] rounded border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-600"
                        />
                      ) : (
                        <p className="max-w-xs whitespace-pre-wrap break-words text-xs text-gray-400">
                          {issue.resolution_details || '—'}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-300">{issue.user_reporter}</td>
                    {canWrite && (
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => saveSamsungIssueResolution(issue)}
                          className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  );
}
