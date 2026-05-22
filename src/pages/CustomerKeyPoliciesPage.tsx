import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNotificationStore } from '@/stores';
import {
  customerKeyPoliciesApi,
  type CustomerKeyAccessRecord,
  type CustomerKeyModelPrice,
  type CustomerKeyPolicy,
  type CustomerKeyPriceSyncState,
  type CustomerKeySummary,
} from '@/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCheck,
  IconDollarSign,
  IconKey,
  IconRefreshCw,
  IconSearch,
  IconShield,
  IconTimer,
  IconTrash2,
} from '@/components/ui/icons';
import styles from './CustomerKeyPoliciesPage.module.scss';

type FailClosedDraft = 'inherit' | 'true' | 'false';

interface PolicyDraft {
  label: string;
  enabled: boolean;
  allowedModels: string;
  deniedModels: string;
  quotaPeriod: string;
  quotaRequests: string;
  quotaTokens: string;
  quotaCostUSD: string;
  ratePeriod: string;
  rateRequests: string;
  maxConcurrentRequests: string;
  failClosedOnMissingPrice: FailClosedDraft;
}

interface PriceRow {
  model: string;
  price: CustomerKeyModelPrice;
}

const DEFAULT_DRAFT: PolicyDraft = {
  label: '',
  enabled: true,
  allowedModels: '',
  deniedModels: '',
  quotaPeriod: 'monthly',
  quotaRequests: '',
  quotaTokens: '',
  quotaCostUSD: '',
  ratePeriod: '1m',
  rateRequests: '',
  maxConcurrentRequests: '',
  failClosedOnMissingPrice: 'inherit',
};

const quotaPeriodOptions = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'none', label: '不重置' },
];

const ratePeriodOptions = [
  { value: '10s', label: '10 秒' },
  { value: '1m', label: '1 分钟' },
  { value: '5m', label: '5 分钟' },
  { value: '1h', label: '1 小时' },
];

const failClosedOptions = [
  { value: 'inherit', label: '使用全局默认' },
  { value: 'true', label: '缺少价格时阻断' },
  { value: 'false', label: '缺少价格时放行' },
];

const numberText = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  return String(value);
};

const listToText = (values: string[] | undefined): string => (values || []).join('\n');

const parseList = (value: string): string[] => {
  const seen = new Set<string>();
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const parsePositiveInt = (value: string): number => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const parsePositiveFloat = (value: string): number => {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const policyToDraft = (policy?: CustomerKeyPolicy): PolicyDraft => ({
  ...DEFAULT_DRAFT,
  label: policy?.label || '',
  enabled: policy?.enabled !== false,
  allowedModels: listToText(policy?.allowed_models),
  deniedModels: listToText(policy?.denied_models),
  quotaPeriod: policy?.quota?.period || DEFAULT_DRAFT.quotaPeriod,
  quotaRequests: numberText(policy?.quota?.requests),
  quotaTokens: numberText(policy?.quota?.tokens),
  quotaCostUSD: numberText(policy?.quota?.cost_usd),
  ratePeriod: policy?.rate_limit?.period || DEFAULT_DRAFT.ratePeriod,
  rateRequests: numberText(policy?.rate_limit?.requests),
  maxConcurrentRequests: numberText(policy?.max_concurrent_requests),
  failClosedOnMissingPrice:
    typeof policy?.fail_closed_on_missing_price === 'boolean'
      ? policy.fail_closed_on_missing_price
        ? 'true'
        : 'false'
      : 'inherit',
});

const draftToPolicy = (keyId: string, draft: PolicyDraft): CustomerKeyPolicy => {
  const failClosed =
    draft.failClosedOnMissingPrice === 'inherit'
      ? undefined
      : draft.failClosedOnMissingPrice === 'true';

  return {
    key_id: keyId,
    label: draft.label.trim(),
    enabled: draft.enabled,
    allowed_models: parseList(draft.allowedModels),
    denied_models: parseList(draft.deniedModels),
    quota: {
      period: draft.quotaPeriod || DEFAULT_DRAFT.quotaPeriod,
      requests: parsePositiveInt(draft.quotaRequests),
      tokens: parsePositiveInt(draft.quotaTokens),
      cost_usd: parsePositiveFloat(draft.quotaCostUSD),
    },
    rate_limit: {
      period: draft.ratePeriod || DEFAULT_DRAFT.ratePeriod,
      requests: parsePositiveInt(draft.rateRequests),
    },
    max_concurrent_requests: parsePositiveInt(draft.maxConcurrentRequests),
    fail_closed_on_missing_price: failClosed,
  };
};

const formatCompactNumber = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
};

const formatUSD = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '$0';
  return `$${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value)}`;
};

const formatDateTime = (value: string | undefined): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const statusLabel = (record: CustomerKeyAccessRecord): string => {
  if (record.status === 'blocked') return `阻断${record.block_reason ? `: ${record.block_reason}` : ''}`;
  if (record.failed) return '失败';
  return record.status || 'allowed';
};

const filterText = (item: CustomerKeySummary): string =>
  `${item.masked_key} ${item.key_id} ${item.policy?.label || ''}`.toLowerCase();

export function CustomerKeyPoliciesPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [items, setItems] = useState<CustomerKeySummary[]>([]);
  const [selectedKeyID, setSelectedKeyID] = useState('');
  const [draft, setDraft] = useState<PolicyDraft>(DEFAULT_DRAFT);
  const [records, setRecords] = useState<CustomerKeyAccessRecord[]>([]);
  const [priceStatus, setPriceStatus] = useState<CustomerKeyPriceSyncState | null>(null);
  const [prices, setPrices] = useState<Record<string, CustomerKeyModelPrice>>({});
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [error, setError] = useState('');
  const [keySearch, setKeySearch] = useState('');
  const [priceSearch, setPriceSearch] = useState('');
  const autoPriceSyncRef = useRef(false);

  const label = useCallback(
    (key: string, defaultValue: string, values?: Record<string, unknown>) =>
      t(`customer_key_policy.${key}`, { defaultValue, ...(values || {}) }),
    [t]
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.key_id === selectedKeyID) || null,
    [items, selectedKeyID]
  );

  const filteredItems = useMemo(() => {
    const query = keySearch.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => filterText(item).includes(query));
  }, [items, keySearch]);

  const priceRows = useMemo<PriceRow[]>(
    () =>
      Object.entries(prices)
        .map(([model, price]) => ({ model, price }))
        .sort((left, right) => left.model.localeCompare(right.model)),
    [prices]
  );

  const filteredPriceRows = useMemo(() => {
    const query = priceSearch.trim().toLowerCase();
    const source = query
      ? priceRows.filter((row) => row.model.toLowerCase().includes(query))
      : priceRows;
    return source.slice(0, 80);
  }, [priceRows, priceSearch]);

  const loadPolicies = useCallback(async () => {
    const data = await customerKeyPoliciesApi.list();
    setItems(data.items);
    setSelectedKeyID((current) => {
      if (current && data.items.some((item) => item.key_id === current)) return current;
      return data.items[0]?.key_id || '';
    });
  }, []);

  const loadRecords = useCallback(async (keyId: string) => {
    if (!keyId) {
      setRecords([]);
      return;
    }
    setRecordsLoading(true);
    try {
      const data = await customerKeyPoliciesApi.records(keyId, 100);
      setRecords(data.records);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  const loadPrices = useCallback(async () => {
    const data = await customerKeyPoliciesApi.prices();
    setPriceStatus(data.status);
    setPrices(data.prices);
    return data;
  }, []);

  const syncPrices = useCallback(
    async (silent = false) => {
      setSyncingPrices(true);
      try {
        const synced = await customerKeyPoliciesApi.syncPrices();
        setPriceStatus(synced.status);
        await loadPrices();
        if (!silent) {
          showNotification(label('price_sync_success', 'LiteLLM 价格已同步'), 'success');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : label('unknown_error', '未知错误');
        if (!silent) {
          showNotification(`${label('price_sync_failed', 'LiteLLM 价格同步失败')}: ${message}`, 'error');
        }
      } finally {
        setSyncingPrices(false);
      }
    },
    [label, loadPrices, showNotification]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [, priceResult] = await Promise.all([loadPolicies(), loadPrices()]);
      if (
        priceResult.status.enabled &&
        priceResult.status.models === 0 &&
        !autoPriceSyncRef.current
      ) {
        autoPriceSyncRef.current = true;
        void syncPrices(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : label('load_failed', '加载失败');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [label, loadPolicies, loadPrices, syncPrices]);

  useHeaderRefresh(loadAll);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedItem) {
      setDraft(DEFAULT_DRAFT);
      return;
    }
    setDraft(policyToDraft(selectedItem.policy));
  }, [selectedItem]);

  useEffect(() => {
    void loadRecords(selectedKeyID);
  }, [loadRecords, selectedKeyID]);

  const updateDraft = useCallback((patch: Partial<PolicyDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const addAllowedModel = useCallback((model: string) => {
    setDraft((current) => {
      const existing = parseList(current.allowedModels);
      if (existing.some((entry) => entry.toLowerCase() === model.toLowerCase())) return current;
      return { ...current, allowedModels: [...existing, model].join('\n') };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      const policy = draftToPolicy(selectedItem.key_id, draft);
      await customerKeyPoliciesApi.update(selectedItem.key_id, policy);
      await loadPolicies();
      await loadRecords(selectedItem.key_id);
      showNotification(label('save_success', '客户 Key 策略已保存'), 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : label('unknown_error', '未知错误');
      showNotification(`${label('save_failed', '保存失败')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, label, loadPolicies, loadRecords, selectedItem, showNotification]);

  const handleDeletePolicy = useCallback(async () => {
    if (!selectedItem) return;
    if (!selectedItem.policy) {
      setDraft(DEFAULT_DRAFT);
      return;
    }
    setSaving(true);
    try {
      await customerKeyPoliciesApi.delete(selectedItem.key_id);
      await loadPolicies();
      showNotification(label('reset_success', '已恢复默认策略'), 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : label('unknown_error', '未知错误');
      showNotification(`${label('reset_failed', '恢复默认失败')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [label, loadPolicies, selectedItem, showNotification]);

  const configuredCount = items.filter((item) => item.configured).length;
  const policyCount = items.filter((item) => item.policy).length;
  const selectedStatus = selectedItem?.status;
  const priceCount = priceStatus?.models ?? priceRows.length;

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{label('title', '客户 API Key 策略')}</h1>
          <p className={styles.description}>
            {label('description', '按客户 API key 独立控制可用模型、硬额度、周期、并发限速与访问记录。')}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" size="sm" onClick={loadAll} disabled={loading}>
            <IconRefreshCw size={16} />
            {label('refresh', '刷新')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => syncPrices(false)}
            loading={syncingPrices}
          >
            <IconDollarSign size={16} />
            {label('sync_prices', '同步价格')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryItem}>
          <IconKey size={18} />
          <span>{label('summary_keys', '客户 Key')}</span>
          <strong>{configuredCount}</strong>
        </div>
        <div className={styles.summaryItem}>
          <IconShield size={18} />
          <span>{label('summary_policies', '已配置策略')}</span>
          <strong>{policyCount}</strong>
        </div>
        <div className={styles.summaryItem}>
          <IconDollarSign size={18} />
          <span>{label('summary_prices', '价格模型')}</span>
          <strong>{formatCompactNumber(priceCount)}</strong>
        </div>
        <div className={styles.summaryItem}>
          <IconTimer size={18} />
          <span>{label('summary_last_sync', '价格同步')}</span>
          <strong>{formatDateTime(priceStatus?.last_sync)}</strong>
        </div>
      </div>

      <div className={styles.mainGrid}>
        <section className={styles.keyPanel} aria-label={label('keys_panel', '客户 Key 列表')}>
          <div className={styles.panelHeader}>
            <h2>{label('keys_title', '客户 Key')}</h2>
          </div>
          <Input
            value={keySearch}
            onChange={(event) => setKeySearch(event.target.value)}
            placeholder={label('key_search_placeholder', '搜索 Key / 标签')}
            aria-label={label('key_search_label', '搜索客户 Key')}
            rightElement={<IconSearch size={16} />}
          />
          <div className={styles.keyList}>
            {loading ? (
              <div className={styles.inlineState}>{label('loading', '加载中...')}</div>
            ) : filteredItems.length === 0 ? (
              <EmptyState
                title={label('empty_keys', '暂无客户 Key')}
                description={label('empty_keys_desc', '先在配置页添加 API key，随后这里会自动出现。')}
              />
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.key_id}
                  type="button"
                  className={`${styles.keyItem} ${item.key_id === selectedKeyID ? styles.keyItemActive : ''}`}
                  onClick={() => setSelectedKeyID(item.key_id)}
                >
                  <span className={styles.keyName}>{item.policy?.label || item.masked_key || item.key_id}</span>
                  <span className={styles.keyMeta}>{item.masked_key || item.key_id}</span>
                  <span className={styles.keyBadges}>
                    <span className={item.configured ? styles.badgeGood : styles.badgeMuted}>
                      {item.configured ? label('configured', '已拉取') : label('stale_policy', '未配置 Key')}
                    </span>
                    <span className={item.policy ? styles.badgeGood : styles.badgeMuted}>
                      {item.policy ? label('policy_saved', '策略') : label('default_policy', '默认')}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className={styles.editorPanel} aria-label={label('editor_panel', '策略编辑')}>
          {selectedItem ? (
            <>
              <div className={styles.panelHeader}>
                <div>
                  <h2>{selectedItem.policy?.label || selectedItem.masked_key}</h2>
                  <p>{selectedItem.key_id}</p>
                </div>
                <div className={styles.editorActions}>
                  <Button variant="ghost" size="sm" onClick={handleDeletePolicy} disabled={saving}>
                    <IconTrash2 size={16} />
                    {label('reset_policy', '恢复默认')}
                  </Button>
                  <Button size="sm" onClick={handleSave} loading={saving}>
                    <IconCheck size={16} />
                    {label('save_policy', '保存策略')}
                  </Button>
                </div>
              </div>

              <div className={styles.statusGrid}>
                <div>
                  <span>{label('used_requests', '已用请求')}</span>
                  <strong>{formatCompactNumber(selectedStatus?.window?.requests)}</strong>
                </div>
                <div>
                  <span>{label('used_tokens', '已用 Tokens')}</span>
                  <strong>{formatCompactNumber(selectedStatus?.window?.tokens)}</strong>
                </div>
                <div>
                  <span>{label('used_cost', '已用成本')}</span>
                  <strong>{formatUSD(selectedStatus?.window?.cost_usd)}</strong>
                </div>
                <div>
                  <span>{label('in_flight', '当前并发')}</span>
                  <strong>{formatCompactNumber(selectedStatus?.in_flight)}</strong>
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formFieldWide}>
                  <Input
                    label={label('label_field', '显示名称')}
                    value={draft.label}
                    onChange={(event) => updateDraft({ label: event.target.value })}
                    placeholder={selectedItem.masked_key}
                  />
                </div>
                <div className={styles.switchField}>
                  <ToggleSwitch
                    checked={draft.enabled}
                    onChange={(enabled) => updateDraft({ enabled })}
                    label={draft.enabled ? label('policy_enabled', '启用策略') : label('policy_disabled', '停用策略')}
                  />
                </div>
                <div className={styles.formField}>
                  <label>{label('quota_period', '额度周期')}</label>
                  <Select
                    value={draft.quotaPeriod}
                    options={quotaPeriodOptions}
                    onChange={(quotaPeriod) => updateDraft({ quotaPeriod })}
                    ariaLabel={label('quota_period', '额度周期')}
                  />
                </div>
                <Input
                  label={label('request_quota', '请求额度')}
                  value={draft.quotaRequests}
                  type="number"
                  min={0}
                  onChange={(event) => updateDraft({ quotaRequests: event.target.value })}
                  placeholder="0"
                />
                <Input
                  label={label('token_quota', 'Token 额度')}
                  value={draft.quotaTokens}
                  type="number"
                  min={0}
                  onChange={(event) => updateDraft({ quotaTokens: event.target.value })}
                  placeholder="0"
                />
                <Input
                  label={label('cost_quota', '成本额度 USD')}
                  value={draft.quotaCostUSD}
                  type="number"
                  min={0}
                  step="0.0001"
                  onChange={(event) => updateDraft({ quotaCostUSD: event.target.value })}
                  placeholder="0"
                />
                <div className={styles.formField}>
                  <label>{label('rate_period', '限速窗口')}</label>
                  <Select
                    value={draft.ratePeriod}
                    options={ratePeriodOptions}
                    onChange={(ratePeriod) => updateDraft({ ratePeriod })}
                    ariaLabel={label('rate_period', '限速窗口')}
                  />
                </div>
                <Input
                  label={label('rate_requests', '窗口请求数')}
                  value={draft.rateRequests}
                  type="number"
                  min={0}
                  onChange={(event) => updateDraft({ rateRequests: event.target.value })}
                  placeholder="0"
                />
                <Input
                  label={label('concurrency', '最大并发')}
                  value={draft.maxConcurrentRequests}
                  type="number"
                  min={0}
                  onChange={(event) => updateDraft({ maxConcurrentRequests: event.target.value })}
                  placeholder="0"
                />
                <div className={styles.formField}>
                  <label>{label('missing_price_policy', '缺少价格')}</label>
                  <Select
                    value={draft.failClosedOnMissingPrice}
                    options={failClosedOptions}
                    onChange={(value) =>
                      updateDraft({ failClosedOnMissingPrice: value as FailClosedDraft })
                    }
                    ariaLabel={label('missing_price_policy', '缺少价格')}
                  />
                </div>
              </div>

              <div className={styles.modelGrid}>
                <label>
                  <span>{label('allowed_models', '允许模型')}</span>
                  <textarea
                    value={draft.allowedModels}
                    onChange={(event) => updateDraft({ allowedModels: event.target.value })}
                    placeholder="gpt-4o&#10;claude-*"
                  />
                </label>
                <label>
                  <span>{label('denied_models', '阻断模型')}</span>
                  <textarea
                    value={draft.deniedModels}
                    onChange={(event) => updateDraft({ deniedModels: event.target.value })}
                    placeholder="*-preview&#10;gpt-4.1-mini"
                  />
                </label>
              </div>
            </>
          ) : (
            <EmptyState
              title={label('select_empty', '请选择客户 Key')}
              description={label('select_empty_desc', '客户 Key 会从当前 CPA 配置自动拉取。')}
            />
          )}
        </section>
      </div>

      <section className={styles.pricePanel} aria-label={label('price_panel', 'LiteLLM 价格')}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{label('prices_title', 'LiteLLM 价格')}</h2>
            <p>
              {priceStatus?.last_error
                ? priceStatus.last_error
                : label('prices_source', '来源: {{source}}', {
                    source: priceStatus?.source_url || '-',
                  })}
            </p>
          </div>
          <div className={styles.priceSearch}>
            <Input
              value={priceSearch}
              onChange={(event) => setPriceSearch(event.target.value)}
              placeholder={label('price_search_placeholder', '搜索模型价格')}
              aria-label={label('price_search_label', '搜索模型价格')}
              rightElement={<IconSearch size={16} />}
            />
          </div>
        </div>
        {priceRows.length === 0 ? (
          <EmptyState
            title={label('prices_empty', '价格缓存为空')}
            description={label('prices_empty_desc', '页面会自动同步 LiteLLM 价格，也可以手动刷新。')}
            action={
              <Button size="sm" onClick={() => syncPrices(false)} loading={syncingPrices}>
                <IconDollarSign size={16} />
                {label('sync_prices', '同步价格')}
              </Button>
            }
          />
        ) : (
          <div className={styles.priceTableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{label('model', '模型')}</th>
                  <th>{label('input_price', '输入 / 1M')}</th>
                  <th>{label('output_price', '输出 / 1M')}</th>
                  <th>{label('cached_price', '缓存 / 1M')}</th>
                  <th>{label('action', '操作')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPriceRows.map((row) => (
                  <tr key={row.model}>
                    <td className={styles.modelCell}>{row.model}</td>
                    <td>{formatUSD(row.price.input_cost_per_million)}</td>
                    <td>{formatUSD(row.price.output_cost_per_million)}</td>
                    <td>{formatUSD(row.price.cached_input_cost_per_million)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addAllowedModel(row.model)}
                        disabled={!selectedItem}
                        title={label('allow_model', '加入允许模型')}
                        aria-label={label('allow_model', '加入允许模型')}
                      >
                        <IconCheck size={15} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.recordsPanel} aria-label={label('records_panel', '访问记录')}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{label('records_title', '访问记录')}</h2>
            <p>{selectedItem?.masked_key || '-'}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadRecords(selectedKeyID)}
            disabled={!selectedKeyID || recordsLoading}
          >
            <IconRefreshCw size={16} />
            {label('refresh_records', '刷新记录')}
          </Button>
        </div>
        {recordsLoading ? (
          <div className={styles.inlineState}>{label('loading', '加载中...')}</div>
        ) : records.length === 0 ? (
          <EmptyState
            title={label('records_empty', '暂无访问记录')}
            description={label('records_empty_desc', '该 Key 产生请求后会显示最近的访问结果。')}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{label('time', '时间')}</th>
                  <th>{label('model', '模型')}</th>
                  <th>{label('status', '状态')}</th>
                  <th>{label('provider', '提供商')}</th>
                  <th>{label('latency', '延迟')}</th>
                  <th>{label('cost', '成本')}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDateTime(record.timestamp)}</td>
                    <td className={styles.modelCell}>{record.alias || record.model || '-'}</td>
                    <td>
                      <span
                        className={
                          record.status === 'blocked' || record.failed
                            ? styles.badgeDanger
                            : styles.badgeGood
                        }
                      >
                        {statusLabel(record)}
                      </span>
                    </td>
                    <td>{record.provider || '-'}</td>
                    <td>{typeof record.latency_ms === 'number' ? `${record.latency_ms} ms` : '-'}</td>
                    <td>{formatUSD(record.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
