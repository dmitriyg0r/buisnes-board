import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { CodexIntegration } from './CodexIntegration';
import { initials, roles, type Settings } from './settings';

interface Props {
  settings: Settings;
  initialTab: SettingsTab;
  email: string;
  onLogout: () => void;
  patch: (p: Partial<Settings>) => void;
  onClose: () => void;
  onClear: () => void;
  onResetView: () => void;
}

export type SettingsTab = 'profile' | 'project' | 'canvas' | 'integrations';
type Tab = SettingsTab;

function Toggle({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="pcheck toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-text">
        <b>{label}</b>
        <small>{hint}</small>
      </span>
    </label>
  );
}

export function SettingsDialog({ settings, initialTab, email, onLogout, patch, onClose, onClear, onResetView }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Профиль' },
    { id: 'project', label: 'Проект' },
    { id: 'canvas', label: 'Полотно' },
    { id: 'integrations', label: 'Интеграции' },
  ];

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label="Настройки">
        <div className="dlg-head">
          <span className="avatar a1 big">{initials(settings.name)}</span>
          <div className="dlg-title">
            <b>Настройки</b>
            <small>{settings.name} · {settings.role}</small>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dlg-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`dlg-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="dlg-body">
          {tab === 'profile' && (
            <>
              <div className="prow">
                <span className="plabel">Почта</span>
                <span className="pstatic">{email}</span>
              </div>
              <label className="prow">
                <span className="plabel">Имя</span>
                <input className="pinput" value={settings.name} onChange={(e) => patch({ name: e.target.value })} />
              </label>
              <label className="prow">
                <span className="plabel">Роль</span>
                <select className="pinput" value={settings.role} onChange={(e) => patch({ role: e.target.value })}>
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <p className="pnote">Имя и роль показываются в шапке и сохраняются в вашем аккаунте.</p>
              <div className="pactions">
                <button type="button" className="btn" onClick={onLogout}>Выйти из аккаунта</button>
              </div>
            </>
          )}

          {tab === 'project' && (
            <>
              <label className="prow">
                <span className="plabel">Название проекта</span>
                <input className="pinput" value={settings.projectName} onChange={(e) => patch({ projectName: e.target.value })} />
              </label>
              <div className="pgroup">
                <div className="plabel">Данные проекта</div>
                <div className="pactions">
                  {confirm ? (
                    <>
                      <button type="button" className="btn btn-danger" onClick={() => { onClear(); setConfirm(false); }}>Да, очистить</button>
                      <button type="button" className="btn" onClick={() => setConfirm(false)}>Отмена</button>
                    </>
                  ) : (
                    <button type="button" className="btn" onClick={() => setConfirm(true)}>Очистить проект</button>
                  )}
                </div>
                <p className="pnote">Очистка удаляет модель процесса, документ, источники, связи, атрибуты и статусы замечаний. Очистку можно отменить через ⌘Z, пока страница открыта.</p>
              </div>
            </>
          )}

          {tab === 'integrations' && <CodexIntegration />}

          {tab === 'canvas' && (
            <>
              <Toggle label="Сетка из точек" hint="Фон полотна" value={settings.grid} onChange={(v) => patch({ grid: v })} />
              <Toggle label="Привязка к сетке" hint="Узлы модели выравниваются по шагу 8 px" value={settings.snap} onChange={(v) => patch({ snap: v })} />
              <Toggle
                label="Колёсико мыши масштабирует доску"
                hint="Выключено: колёсико и тачпад прокручивают доску. Масштаб всегда доступен через Ctrl или ⌘ + колёсико и щипок"
                value={settings.wheelZoom}
                onChange={(v) => patch({ wheelZoom: v })}
              />
              <Toggle label="Миникарта" hint="Обзор полотна в левом нижнем углу" value={settings.minimap} onChange={(v) => patch({ minimap: v })} />
              <div className="pgroup">
                <div className="plabel">Положение</div>
                <div className="pactions">
                  <button type="button" className="btn" onClick={onResetView}>Сбросить камеру и карточки</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="dlg-foot">
          <span>Настройки сохраняются автоматически</span>
          <button type="button" className="btn btn-dark" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
