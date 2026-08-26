import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { db } from './db';
import { PartnerKind, partnerService } from './partners';
import type { Partner, PartnerKind as PartnerKindValue } from './partners';

const KIND_LABELS: Record<PartnerKindValue, string> = {
  CUSTOMER: 'Khách hàng',
  SUPPLIER: 'Nhà cung cấp',
  BOTH: 'Khách hàng & NCC',
};

export function PartnerManager() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PartnerKindValue>(PartnerKind.CUSTOMER);
  const [taxCode, setTaxCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setPartners(await db.partners.orderBy('code').toArray());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  async function createPartner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setMessage(null); setSaving(true);
    try {
      await partnerService.create({ code: code.trim(), name: name.trim(), kind, taxCode: taxCode.trim() || undefined });
      setCode(''); setName(''); setTaxCode('');
      setMessage('Đã tạo partner. Giao dịch công nợ sẽ chọn từ danh mục này.');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể tạo partner.');
    } finally { setSaving(false); }
  }

  async function toggle(partner: Partner) {
    setError(null); setMessage(null);
    try {
      await partnerService.setActive(partner.id, !partner.active);
      setMessage(partner.active ? 'Đã ngừng sử dụng partner; lịch sử cũ vẫn được giữ.' : 'Đã kích hoạt lại partner.');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể cập nhật partner.');
    }
  }

  return (
    <section className="settings-card form-section" aria-labelledby="partner-manager-title">
      <div className="book-mapping-card__heading">
        <div><strong id="partner-manager-title">Danh mục khách hàng / nhà cung cấp</strong><p>Không còn nhập Partner UUID thủ công cho giao dịch mới.</p></div>
        <span className="tt58-badge">{partners.filter((partner) => partner.active).length} active</span>
      </div>
      <form onSubmit={createPartner} className="compact-form">
        <div className="form-grid two-columns">
          <label><span>Mã partner</span><input value={code} onChange={(event) => setCode(event.target.value)} required /></label>
          <label><span>Tên</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        </div>
        <div className="form-grid two-columns">
          <label><span>Vai trò</span><select value={kind} onChange={(event) => setKind(event.target.value as PartnerKindValue)}>{Object.values(PartnerKind).map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}</select></label>
          <label><span>Mã số thuế</span><input value={taxCode} onChange={(event) => setTaxCode(event.target.value)} /></label>
        </div>
        <button className="secondary-button" type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Thêm partner'}</button>
      </form>
      {error ? <p className="form-alert error" role="alert">{error}</p> : null}
      {message ? <p className="form-alert success" role="status">{message}</p> : null}
      <div className="account-list">
        {partners.map((partner) => (
          <div className="account-row" key={partner.id}>
            <div><strong>{partner.code} · {partner.name}</strong><small>{KIND_LABELS[partner.kind]}{partner.taxCode ? ` · MST ${partner.taxCode}` : ''}</small></div>
            <button className="secondary-button" type="button" onClick={() => void toggle(partner)}>{partner.active ? 'Ngừng dùng' : 'Kích hoạt'}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
