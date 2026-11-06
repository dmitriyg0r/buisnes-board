import { useEffect, useRef, useState } from 'react';
import { HttpError } from './api';
import {
  checkCodex,
  disconnectCodex,
  getCodex,
  pollCodexLogin,
  startCodexLogin,
  type DeviceCode,
  type IntegrationStatus,
} from './integrations';

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const errText = (e: unknown) => (e instanceof HttpError && e.detail ? e.detail : 'Нет связи с сервером');

export function CodexIntegration() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  // начатый вход: код, который пользователь вводит на странице OpenAI
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const timer = useRef<number | null>(null);

  const stopPolling = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopPolling, []);

  useEffect(() => {
    getCodex()
      .then(setStatus)
      .catch(() => setLoadError(true));
  }, []);

  // опрашиваем сервер, пока пользователь не подтвердит код; прекращаем при ошибке или истечении кода
  useEffect(() => {
    if (!device) return;
    const deadline = Date.now() + device.expires_in * 1000;
    const tick = async () => {
      if (Date.now() > deadline) {
        setDevice(null);
        setMsg({ ok: false, text: 'Код истёк. Начните подключение заново.' });
        return;
      }
      try {
        const r = await pollCodexLogin();
        if (r.state === 'connected') {
          setStatus(r.status);
          setDevice(null);
          setMsg({ ok: true, text: 'ChatGPT подключён.' });
          return;
        }
      } catch (err) {
        setDevice(null);
        setMsg({ ok: false, text: errText(err) });
        return;
      }
      timer.current = window.setTimeout(() => void tick(), device.interval * 1000);
    };
    timer.current = window.setTimeout(() => void tick(), device.interval * 1000);
    return stopPolling;
  }, [device]);

  if (loadError) return <p className="auth-error" role="alert">Не удалось загрузить состояние подключения.</p>;
  if (!status) return <p className="pnote">Загрузка…</p>;

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setDevice(await startCodexLogin());
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setBusy(false);
  };

  const cancel = () => {
    stopPolling();
    setDevice(null);
    setMsg(null);
  };

  const check = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await checkCodex();
      setMsg({ ok: true, text: 'Подключение действует.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCodex();
      setStatus({ ...status, connected: false, legacy: false, hint: null, updated_at: null });
      setMsg({ ok: true, text: 'ChatGPT отключён, токены удалены с сервера.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setConfirmOff(false);
    setBusy(false);
  };

  const connectButton = (label: string) => (
    <button type="button" className="btn btn-dark" disabled={!status.available || busy} onClick={() => void start()}>
      {busy ? 'Запрашиваем код…' : label}
    </button>
  );

  return (
    <section className="codex" aria-label="Codex">
      <div className="codex-head">
        <div>
          <b>Codex</b>
          <small>Помощник на базе OpenAI</small>
        </div>
        <span className={`chip ${status.connected && !status.legacy ? 'chip-green' : 'chip-neutral'}`}>
          {status.connected ? (status.legacy ? 'Нужно переподключить' : 'Подключён') : 'Не подключён'}
        </span>
      </div>

      {!status.available && (
        <p className="auth-error" role="alert">На сервере не задан SECRETS_KEY. Пока администратор его не задаст, подключать сервисы нельзя.</p>
      )}

      {device ? (
        <div className="codex-form">
          <ol className="note">
            <li>Откройте <a href={device.verification_url} target="_blank" rel="noopener noreferrer">{device.verification_url}</a> и войдите в ChatGPT.</li>
            <li>Введите код:</li>
          </ol>
          <p><b className="codex-code" aria-label="Код подтверждения">{device.user_code}</b></p>
          <p className="pnote" role="status">Ждём подтверждения… Код действует {Math.round(device.expires_in / 60)} минут.</p>
          <div className="pactions">
            <button type="button" className="btn" onClick={cancel}>Отмена</button>
          </div>
        </div>
      ) : status.connected ? (
        <>
          <p className="note">
            {status.legacy ? 'Подключён по старому API-ключу. Подключите ChatGPT, ключ будет заменён.' : `Аккаунт ${status.hint ?? 'ChatGPT'}`}
            {status.updated_at ? ` · сохранён ${fmt(status.updated_at)}` : ''}
          </p>
          <div className="pactions">
            {status.legacy ? (
              connectButton('Подключить ChatGPT')
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => void check()}>Проверить подключение</button>
            )}
            {confirmOff ? (
              <>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void disconnect()}>Да, отключить</button>
                <button type="button" className="btn" onClick={() => setConfirmOff(false)}>Отмена</button>
              </>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirmOff(true)}>Отключить</button>
            )}
          </div>
        </>
      ) : (
        <div className="pactions">{connectButton('Подключить ChatGPT')}</div>
      )}

      {msg && <div className={msg.ok ? 'codex-ok' : 'auth-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}

      <p className="pnote">Вход выполняется на сайте OpenAI, пароль сюда не передаётся. Токены хранятся на сервере в зашифрованном виде и видны только вам. Для работы нужно включить вход по коду в настройках безопасности ChatGPT. Функции ИИ на доске пока их не используют, подключение сохраняется заранее.</p>
    </section>
  );
}
