import { FormEvent, useEffect, useMemo, useState } from 'react';
import { db } from './db';
import {
  ACCOUNTING_REGIME_INFO,
  AccountingProfile,
  AccountingProfileSchema,
  AccountingRegime,
  ENTITY_TYPE_LABELS,
  EntityType,
  getAllowedEntityTypes,
} from './accountingProfile';
import './AccountingSettings.css';

const selectableRegimes: AccountingRegime[] = [
  'TT152_2025_HKD',
  'TT58_2026_MICRO',
  'TT133_2016_SME',
];

function defaultEntityType(regime: AccountingRegime): EntityType {
  return getAllowedEntityTypes(regime)[0];
}

export function AccountingSettings() {
  const [profile, setProfile] = useState<AccountingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [regime, setRegime] = useState<AccountingRegime>('TT152_2025_HKD');
  const [entityType, setEntityType] = useState<EntityType>('HOUSEHOLD_BUSINESS');
  const [dataStartDate, setDataStartDate] = useState('2026-01-01');

  useEffect(() => {
    let active = true;

    void db.accountingProfiles.get('primary').then((stored) => {
      if (!active) return;
      if (stored) {
        setProfile(stored);
        setRegime(stored.regime);
        setEntityType(stored.entityType);
        setDataStartDate(stored.dataStartDate);
      }
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('Không thể đọc thiết lập kế toán trên thiết bị này.');
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const allowedEntityTypes = useMemo(() => getAllowedEntityTypes(regime), [regime]);
  const selectedRegime = ACCOUNTING_REGIME_INFO[regime];

  function selectRegime(nextRegime: AccountingRegime) {
    const info = ACCOUNTING_REGIME_INFO[nextRegime];
    if (info.implementation === 'PLANNED') return;

    setRegime(nextRegime);
    setEntityType(defaultEntityType(nextRegime));
    setDataStartDate(info.effectiveFrom);
    setMessage(null);
    setError(null);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (selectedRegime.implementation === 'PLANNED') {
      setError('Chế độ TT133 đang ở roadmap và chưa được kích hoạt trong V1.');
      return;
    }

    const now = Date.now();
    const identityChanged = Boolean(profile && (
      profile.regime !== regime
      || profile.entityType !== entityType
      || profile.dataStartDate !== dataStartDate
    ));

    const candidate = {
      id: 'primary' as const,
      regime,
      entityType,
      dataStartDate,
      taxProfileConfigured: identityChanged ? false : (profile?.taxProfileConfigured ?? false),
      vatMethod: identityChanged ? 'UNCONFIGURED' as const : (profile?.vatMethod ?? 'UNCONFIGURED' as const),
      incomeTaxMethod: identityChanged ? 'UNCONFIGURED' as const : (profile?.incomeTaxMethod ?? 'UNCONFIGURED' as const),
      createdAt: profile?.createdAt ?? now,
      updatedAt: now,
    };

    const parsed = AccountingProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Thiết lập chưa hợp lệ.');
      return;
    }

    setSaving(true);
    try {
      await db.accountingProfiles.put(parsed.data);
      setProfile(parsed.data);
      setMessage('Đã lưu chế độ kế toán trên thiết bị.');
    } catch {
      setError('Không thể lưu thiết lập. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-stack" aria-labelledby="accounting-regime-title">
      <div className="settings-intro">
        <p className="eyebrow">Thiết lập nền tảng</p>
        <h2 id="accounting-regime-title">Chế độ kế toán</h2>
        <p>
          Chọn đúng chế độ trước khi nhập dữ liệu. Sổ sách và quy tắc thuế ở các phase sau sẽ được bật theo thiết lập này.
        </p>
      </div>

      {loading ? (
        <div className="settings-card" role="status">Đang đọc thiết lập trên thiết bị…</div>
      ) : (
        <form className="settings-form" onSubmit={saveProfile}>
          <fieldset className="regime-fieldset">
            <legend>1. Chọn chế độ áp dụng</legend>
            <div className="regime-list">
              {selectableRegimes.map((item) => {
                const info = ACCOUNTING_REGIME_INFO[item];
                const planned = info.implementation === 'PLANNED';
                return (
                  <label className={`regime-option ${planned ? 'is-planned' : ''}`} key={item}>
                    <input
                      type="radio"
                      name="accounting-regime"
                      value={item}
                      checked={regime === item}
                      disabled={planned}
                      onChange={() => selectRegime(item)}
                    />
                    <span className="regime-option__body">
                      <span className="regime-option__topline">
                        <strong>{info.shortLabel}</strong>
                        {planned ? <span className="roadmap-badge">Giai đoạn sau</span> : null}
                      </span>
                      <span className="regime-option__title">{info.title}</span>
                      <small>{info.description}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="settings-card form-section">
            <label className="field-label" htmlFor="entity-type">2. Loại hình đơn vị</label>
            <select
              id="entity-type"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value as EntityType)}
            >
              {allowedEntityTypes.map((item) => (
                <option value={item} key={item}>{ENTITY_TYPE_LABELS[item]}</option>
              ))}
            </select>

            <label className="field-label" htmlFor="data-start-date">3. Ngày bắt đầu dữ liệu</label>
            <input
              id="data-start-date"
              type="date"
              value={dataStartDate}
              min={selectedRegime.effectiveFrom}
              onChange={(event) => setDataStartDate(event.target.value)}
            />
            <small className="field-help">
              {selectedRegime.shortLabel} được cấu hình trong app từ {selectedRegime.effectiveFrom} trở đi.
            </small>
          </div>

          <div className="settings-card tax-status-card">
            <div>
              <strong>Hồ sơ phương pháp thuế</strong>
              <p>{profile?.taxProfileConfigured && profile.regime === regime ? 'Đã cấu hình' : 'Chưa cấu hình — sẽ thực hiện ở bước tiếp theo'}</p>
            </div>
            <span className={profile?.taxProfileConfigured && profile.regime === regime ? 'status-dot configured' : 'status-dot'} aria-hidden="true"></span>
          </div>

          {error ? <p className="form-alert error" role="alert">{error}</p> : null}
          {message ? <p className="form-alert success" role="status">{message}</p> : null}

          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Đang lưu…' : profile ? 'Lưu thay đổi' : 'Lưu chế độ kế toán'}
          </button>
        </form>
      )}

      <div className="settings-note">
        <strong>Phạm vi V1</strong>
        <p>Hiện tại app chỉ tạo foundation cho TT152 và TT58. Chưa tuyên bố đầy đủ chứng từ, sổ hoặc báo cáo theo bất kỳ thông tư nào cho đến khi từng projection và test nghiệp vụ hoàn tất.</p>
      </div>
    </section>
  );
}
