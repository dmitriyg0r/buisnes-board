import { http } from './api';

export interface IntegrationStatus {
  connected: boolean;
  /** почта ChatGPT или хвост идентификатора аккаунта */
  hint: string | null;
  updated_at: string | null;
  /** false, если на сервере не задан SECRETS_KEY */
  available: boolean;
  /** старое подключение по API-ключу: нужно заменить входом через ChatGPT */
  legacy: boolean;
}

export interface DeviceCode {
  user_code: string;
  verification_url: string;
  /** как часто опрашивать, секунды */
  interval: number;
  /** через сколько секунд код истечёт */
  expires_in: number;
}

export type PollResult = { state: 'pending' } | { state: 'connected'; status: IntegrationStatus };

export const getCodex = () => http<IntegrationStatus>('GET', '/integrations/codex');
export const startCodexLogin = () => http<DeviceCode>('POST', '/integrations/codex/device');
export const pollCodexLogin = () => http<PollResult>('POST', '/integrations/codex/device/poll');
export const checkCodex = () => http<{ ok: boolean }>('POST', '/integrations/codex/check');
export const disconnectCodex = () => http<void>('DELETE', '/integrations/codex');
