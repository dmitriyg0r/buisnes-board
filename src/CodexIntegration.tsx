import { useEffect, useState } from 'react';
import { HttpError } from './api';
import { checkCodex, connectCodex, disconnectCodex, getCodex, type IntegrationStatus } from './integrations';

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const errText = (e: unknown) => (e instanceof HttpError && e.detail ? e.detail : 'Нет связи с сервером');

export function CodexIntegration() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    getCodex()
      .then(setStatus)
      .catch(() => setLoadError(true));
  }, []);

  if (loadError) return <p className="auth-error" role="alert">Не удалось загрузить состояние подключения.</p>;
  if (!status) return <p className="pnote">Загрузка…</p>;

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      setStatus(await connectCodex(key.trim()));
      setKey('');
      setReplacing(false);
      setMsg({ ok: true, text: 'Codex подключён: ключ принят OpenAI и сохранён.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setBusy(false);
  };

  const check = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await checkCodex();
      setMsg({ ok: true, text: 'Ключ действует.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCodex();
      setStatus({ ...status, connected: false, hint: null, updated_at: null });
      setMsg({ ok: true, text: 'Codex отключён, ключ удалён с сервера.' });
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
    setConfirmOff(false);
    setBusy(false);
  };

  const form = (
    <form className="codex-form" onSubmit={connect}>
      <label className="auth-field">
        <span>Ключ OpenAI API</span>
        <input
          className="pinput"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
          disabled={!status.available || busy}
        />
      </label>
      <div className="pactions">
        <button type="submit" className="btn btn-dark" disabled={!status.available || busy || key.trim().length < 20}>
          {busy ? 'Проверяем ключ…' : status.connected ? 'Заменить' : 'Подключить'}
        </button>
        {replacing && (
          <button type="button" className="btn" disabled={busy} onClick={() => { setReplacing(false); setKey(''); }}>Отмена</button>
        )}
      </div>
    </form>
  );

  return (
    <section className="codex" aria-label="Codex">
      <div className="codex-head">
        <div>
          <b>Codex</b>
          <small>Помощник на базе OpenAI</small>
        </div>
        <span className={`chip ${status.connected ? 'chip-green' : 'chip-neutral'}`}>{status.connected ? 'Подключён' : 'Не подключён'}</span>
      </div>

      {!status.available && (
        <p className="auth-error" role="alert">На сервере не задан SECRETS_KEY. Пока администратор его не задаст, подключать сервисы нельзя.</p>
      )}

      {status.connected ? (
        <>
          <p className="note">Ключ {status.hint}{status.updated_at ? ` · сохранён ${fmt(status.updated_at)}` : ''}</p>
          {replacing ? (
            form
          ) : (
            <div className="pactions">
              <button type="button" className="btn" disabled={busy} onClick={() => void check()}>Проверить подключение</button>
              <button type="button" className="btn" disabled={busy} onClick={() => { setReplacing(true); setMsg(null); }}>Заменить ключ</button>
              {confirmOff ? (
                <>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void disconnect()}>Да, отключить</button>
                  <button type="button" className="btn" onClick={() => setConfirmOff(false)}>Отмена</button>
                </>
              ) : (
                <button type="button" className="btn" disabled={busy} onClick={() => setConfirmOff(true)}>Отключить</button>
              )}
            </div>
          )}
        </>
      ) : (
        form
      )}

      {msg && <div className={msg.ok ? 'codex-ok' : 'auth-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}

      <p className="pnote">Ключ хранится на сервере в зашифрованном виде и виден только вам: в интерфейсе показываются лишь последние четыре символа. Функции ИИ на доске пока его не используют, подключение сохраняется заранее.</p>
    </section>
  );
}
