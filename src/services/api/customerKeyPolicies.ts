import { apiClient } from './client';

export interface CustomerKeyQuotaLimits {
  period?: string;
  requests?: number;
  tokens?: number;
  cost_usd?: number;
}

export interface CustomerKeyRateLimit {
  requests?: number;
  period?: string;
}

export interface CustomerKeyPolicy {
  key_id: string;
  label?: string;
  enabled?: boolean;
  allowed_models?: string[];
  denied_models?: string[];
  quota?: CustomerKeyQuotaLimits;
  rate_limit?: CustomerKeyRateLimit;
  max_concurrent_requests?: number;
  fail_closed_on_missing_price?: boolean;
}

export interface CustomerKeyWindowStatus {
  key?: string;
  starts_at?: string;
  ends_at?: string;
  requests?: number;
  tokens?: number;
  cost_usd?: number;
}

export interface CustomerKeyRemaining {
  requests?: number;
  tokens?: number;
  cost_usd?: number;
}

export interface CustomerKeyPriceSyncState {
  enabled: boolean;
  source_url: string;
  last_sync?: string;
  last_error?: string;
  models: number;
}

export interface CustomerKeyStatus {
  key_id: string;
  masked_key: string;
  window: CustomerKeyWindowStatus;
  rate_window: CustomerKeyWindowStatus;
  in_flight: number;
  remaining: CustomerKeyRemaining;
  missing_price?: string[];
  price_sync: CustomerKeyPriceSyncState;
}

export interface CustomerKeySummary {
  key_id: string;
  masked_key: string;
  configured: boolean;
  policy?: CustomerKeyPolicy;
  status: CustomerKeyStatus;
}

export interface CustomerKeyPoliciesResponse {
  items: CustomerKeySummary[];
}

export interface CustomerKeyModelPrice {
  input_cost_per_million?: number;
  output_cost_per_million?: number;
  cached_input_cost_per_million?: number;
}

export interface CustomerKeyPricesResponse {
  status: CustomerKeyPriceSyncState;
  prices: Record<string, CustomerKeyModelPrice>;
}

export interface CustomerKeyRecordsResponse {
  records: CustomerKeyAccessRecord[];
  limit: number;
}

export interface CustomerKeyAccessRecord {
  id: string;
  timestamp: string;
  key_id: string;
  masked_key: string;
  request_id?: string;
  endpoint?: string;
  model?: string;
  alias?: string;
  provider?: string;
  auth_id?: string;
  status: string;
  http_status?: number;
  block_reason?: string;
  failed?: boolean;
  latency_ms?: number;
  cost_usd?: number;
  source?: string;
}

export const customerKeyPoliciesApi = {
  list: async (): Promise<CustomerKeyPoliciesResponse> => {
    const payload = await apiClient.get<CustomerKeyPoliciesResponse>('/customer-key-policies');
    return { items: Array.isArray(payload.items) ? payload.items : [] };
  },

  update: (keyId: string, policy: CustomerKeyPolicy) =>
    apiClient.patch<{ policy: CustomerKeyPolicy }>(
      `/customer-key-policies/${encodeURIComponent(keyId)}`,
      policy
    ),

  delete: (keyId: string) =>
    apiClient.delete<{ status: string }>(`/customer-key-policies/${encodeURIComponent(keyId)}`),

  records: async (keyId: string, limit = 100): Promise<CustomerKeyRecordsResponse> => {
    const payload = await apiClient.get<CustomerKeyRecordsResponse>(
      `/customer-key-policies/${encodeURIComponent(keyId)}/records`,
      { params: { limit } }
    );
    return {
      records: Array.isArray(payload.records) ? payload.records : [],
      limit: payload.limit || limit,
    };
  },

  prices: async (): Promise<CustomerKeyPricesResponse> => {
    const payload = await apiClient.get<CustomerKeyPricesResponse>('/customer-key-prices');
    return {
      status: payload.status,
      prices: payload.prices && typeof payload.prices === 'object' ? payload.prices : {},
    };
  },

  syncPrices: () =>
    apiClient.post<{ status: CustomerKeyPriceSyncState }>('/customer-key-prices/sync'),
};
