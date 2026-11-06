import { http } from './api';

export interface IntegrationStatus {
  connected: boolean;
  hint: string | null;
  updated_at: string | null;
  /** false, если на сервере не задан SECRETS_KEY */
  available: boolean;
}

export const getCodex = () => http<IntegrationStatus>('GET', '/integrations/codex');
export const connectCodex = (apiKey: string) => http<IntegrationStatus>('PUT', '/integrations/codex', { api_key: apiKey });
export const checkCodex = () => http<{ ok: boolean }>('POST', '/integrations/codex/check');
export const disconnectCodex = () => http<void>('DELETE', '/integrations/codex');
