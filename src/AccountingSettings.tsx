import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AccountManager } from './AccountManager';
import { DataSafetyPanel } from './DataSafetyPanel';
import { PartnerManager } from './PartnerManager';
import { ReleaseTools } from './ReleaseTools';
import { db } from './db';
import {
  ACCOUNTING_REGIME_INFO,
  AccountingProfileSchema,
  ENTITY_TYPE_LABELS,
  INCOME_TAX_METHOD_LABELS,
  TT58_EFFECTIVE_FROM,
  TT58_REGIME,
  VAT_METHOD_LABELS,
  getAllowedEntityTypes,
  getRequiredTt58Books,
  getTt58ApplicationBasis,
} from './accountingProfile';
import type {
  AccountingProfile,
  EntityType,
  IncomeTaxMethod,
  VatMethod,
} from './accountingProfile';
import './AccountingSettings.css';

const allowedEntityTypes = getAllowedEntityTypes();

export function AccountingSettings() {
  const [profile, setProfile] = useState<AccountingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legacyProfileDetected, setLegacyProfileDetected] = useState(false);

  const [entityType, setEntityType] = useState<EntityType>('MICRO_ENTERPRISE');
  const [entityName, setEntityName] = useState('');
  const [entityAddress, setEntityAddress] = useState('');
  const [dataStartDate, setDataStartDate] = useState<string>(TT58_EFFECTIVE_FROM);
  const [vatMethod, setVatMethod] = useState<VatMethod>('UNCONFIGURED');
  const [incomeTaxMethod, setIncomeTaxMethod] = useState<IncomeTaxMethod>('UNCONFIGURED');

  useEffect(() => {
    let active = true;

    void db.accountingProfiles.get('primary').then((stored) => {
      if (!active) return;

      if (stored) {
        const parsed = AccountingProfileSchema.safeParse(stored);
        if (parsed.success) {
          setProfile(parsed.data);
          setEntityType(parsed.data.entityType);
          setEntityName(parsed.data.entityName ?? '');
          setEntityAddress(parsed.data.entityAddress ?? '');
          setDataStartDate(parsed.data.dataStartDate);
          setVatMethod(parsed.data.vatMethod);
          setIncomeTaxMethod(parsed.data.incomeTaxMethod);
        } else {
          setLegacyProfileDetected(true);
        }
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

  const applicationBasis = getTt58ApplicationBasis(entityType);
  const incomeTaxName = entityType === 'MICRO_ENTERPRISE' ? 'Thuế TNDN' : 'Thuế TNCN';

  const taxSelectionState = useMemo(() => {
    const vatConfigured = vatMethod !== 'UNCONFIGURED';
    const incomeConfigured = incomeTaxMethod !== 'UNCONFIGURED';

    if (!vatConfigured && !incomeConfigured) return 'EMPTY' as const;
    if (vatConfigured && incomeConfigured) return 'COMPLETE' as const;
    return 'PARTIAL' as const;
  }, [vatMethod, incomeTaxMethod]);

  const requiredBooks = useMemo(() => {
    if (taxSelectionState !== 'COMPLETE') return [];

    return getRequiredTt58Books({
      taxProfileConfigured: true,
      vatMethod,
      incomeTaxMethod,
    });
  }, [incomeTaxMethod, taxSelectionState, vatMethod]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (taxSelectionState === 'PARTIAL') {
      setError('Hãy chọn cả phương pháp thuế GTGT và phương pháp thuế thu nhập, hoặc để cả hai ở trạng thái Chưa cấu hình.');
      return;
    }

    const now = Date.now();
    const candidate = {
      id: 'primary' as const,
      regime: TT58_REGIME,
      entityType,
      entityName: entityName.trim() || undefined,
      entityAddress: entityAddress.trim() || undefined,
      dataStartDate,
      taxProfileConfigured: taxSelectionState === 'COMPLETE',
      vatMethod,
      incomeTaxMethod,
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
      setLegacyProfileDetected(false);
      setMessage('Đã lưu hồ sơ TT58 trên thiết bị.');
    } catch {
      setError('Không thể lưu thiết lập. Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-stack" aria-labelledby="accounting-regime-title">
      <div className="settings-intro">
        <p className="eyebrow">Thiết lập TT58</p>
        <h2 id="accounting-regime-title">Hồ sơ kế toán</h2>
        <p>
          V1 chỉ sử dụng Thông tư 58/2026/TT-BTC. Không có lựa chọn TT152 hoặc TT133 trong ứng dụng.
        </p>
      </div>

      {loading ? (
        <div className="settings-card" role="status">Đang đọc thiết lập trên thiết bị…</div>
      ) : (
        <form className="settings-form" onSubmit={saveProfile}>
          <div className="settings-card regime-fixed-card">
            <div>
              <span className="regime-kicker">Chế độ cố định</span>
              <strong>{ACCOUNTING_REGIME_INFO.shortLabel}</strong>
              <p>{ACCOUNTING_REGIME_INFO.description}</p>
            </div>
            <span className="tt58-badge">TT58</span>
          </div>

          {legacyProfileDetected ? (
            <p className="form-alert warning" role="status">
              Phát hiện thiết lập cũ ngoài phạm vi TT58-only. Ứng dụng không tự chuyển đổi. Hãy xác nhận lại hồ sơ bên dưới rồi bấm Lưu.
            </p>
          ) : null}

          <div className="settings-card form-section">
            <strong>Thông tin in trên sổ TT58</strong>
            <small className="field-help">XLSX chính thức chỉ được tạo từ snapshot có đủ Đơn vị và Địa chỉ. Ứng dụng không tự bịa thông tin này.</small>
            <label className="field-label" htmlFor="entity-name">Đơn vị</label>
            <input id="entity-name" value={entityName} maxLength={200} placeholder="Tên doanh nghiệp / hộ / cá nhân kinh doanh" onChange={(event) => setEntityName(event.target.value)} />
            <label className="field-label" htmlFor="entity-address">Địa chỉ</label>
            <input id="entity-address" value={entityAddress} maxLength={500} placeholder="Địa chỉ ghi trên sổ kế toán" onChange={(event) => setEntityAddress(event.target.value)} />
          </div>

          <div className="settings-card form-section">
            <label className="field-label" htmlFor="entity-type">1. Loại hình đơn vị</label>
            <select
              id="entity-type"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value as EntityType)}
            >
              {allowedEntityTypes.map((item) => (
                <option value={item} key={item}>{ENTITY_TYPE_LABELS[item]}</option>
              ))}
            </select>

            <small className="field-help">
              {applicationBasis === 'VOLUNTARY_ELECTION'
                ? 'HKD/CNKD sử dụng app này trên cơ sở tự nguyện lựa chọn áp dụng TT58.'
                : 'Doanh nghiệp siêu nhỏ thuộc đối tượng áp dụng chính của TT58.'}
            </small>

            <label className="field-label" htmlFor="data-start-date">2. Ngày bắt đầu dữ liệu TT58</label>
            <input
              id="data-start-date"
              type="date"
              value={dataStartDate}
              min={TT58_EFFECTIVE_FROM}
              onChange={(event) => setDataStartDate(event.target.value)}
            />
            <small className="field-help">
              App không cho cấu hình dữ liệu TT58 trước {TT58_EFFECTIVE_FROM}.
            </small>
          </div>

          <fieldset className="settings-card tax-fieldset">
            <legend>3. Phương pháp thuế</legend>

            <label className="field-label" htmlFor="vat-method">Thuế GTGT</label>
            <select
              id="vat-method"
              value={vatMethod}
              onChange={(event) => setVatMethod(event.target.value as VatMethod)}
            >
              <option value="UNCONFIGURED">{VAT_METHOD_LABELS.UNCONFIGURED}</option>
              <option value="PERCENT_ON_REVENUE">{VAT_METHOD_LABELS.PERCENT_ON_REVENUE}</option>
              <option value="DEDUCTION">{VAT_METHOD_LABELS.DEDUCTION}</option>
            </select>

            <label className="field-label" htmlFor="income-tax-method">{incomeTaxName}</label>
            <select
              id="income-tax-method"
              value={incomeTaxMethod}
              onChange={(event) => setIncomeTaxMethod(event.target.value as IncomeTaxMethod)}
            >
              <option value="UNCONFIGURED">{INCOME_TAX_METHOD_LABELS.UNCONFIGURED}</option>
              <option value="PERCENT_ON_REVENUE">{INCOME_TAX_METHOD_LABELS.PERCENT_ON_REVENUE}</option>
              <option value="TAXABLE_INCOME">{INCOME_TAX_METHOD_LABELS.TAXABLE_INCOME}</option>
            </select>

            <small className="field-help">
              Ứng dụng không tự đoán phương pháp thuế. Nếu chưa chắc, để cả hai mục ở trạng thái Chưa cấu hình.
            </small>
          </fieldset>

          <div className="settings-card book-mapping-card">
            <div className="book-mapping-card__heading">
              <div>
                <strong>Bộ sổ TT58 theo hồ sơ thuế</strong>
                <p>{taxSelectionState === 'COMPLETE' ? 'Được xác định từ hai phương pháp thuế đã chọn.' : 'Chưa xác định vì hồ sơ thuế chưa hoàn tất.'}</p>
              </div>
              <span className={taxSelectionState === 'COMPLETE' ? 'status-dot configured' : 'status-dot'} aria-hidden="true"></span>
            </div>

            {requiredBooks.length > 0 ? (
              <div className="book-chip-list" aria-label="Các sổ TT58 cần áp dụng">
                {requiredBooks.map((book) => <span className="book-chip" key={book}>{book}</span>)}
              </div>
            ) : null}
          </div>

          {error ? <p className="form-alert error" role="alert">{error}</p> : null}
          {message ? <p className="form-alert success" role="status">{message}</p> : null}

          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Đang lưu…' : profile ? 'Lưu thay đổi' : 'Lưu hồ sơ TT58'}
          </button>
        </form>
      )}

      <AccountManager />
      <PartnerManager />
      <ReleaseTools />
      <DataSafetyPanel />

      <div className="settings-note">
        <strong>Phạm vi V1</strong>
        <p>
          Chỉ TT58/2026. Các mã sổ hiển thị là mapping yêu cầu theo hồ sơ thuế; trạng thái runtime của từng sổ phụ thuộc dữ liệu thực tế và blocker còn thiếu.
        </p>
      </div>
    </section>
  );
}
