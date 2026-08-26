import { AccountingProfileSchema } from './accountingProfile';
import type { AccountingDB } from './db';
import { db } from './db';
import { partnerSupportsTransaction } from './partners';
import { parseTt58ReportBundle } from './tt58ReportExport';

export type ReleaseDiagnosticSeverity = 'ERROR' | 'WARNING';

export interface ReleaseDiagnostic {
  code: string;
  severity: ReleaseDiagnosticSeverity;
  message: string;
  recordId?: string;
}

export interface ReleaseReadinessReport {
  ready: boolean;
  generatedAt: number;
  diagnostics: readonly ReleaseDiagnostic[];
  counts: {
    accounts: number;
    transactions: number;
    partners: number;
    inventoryItems: number;
    lockedPeriods: number;
  };
}

export class ReleaseReadinessService {
  private readonly database: AccountingDB;

  constructor(database: AccountingDB) {
    this.database = database;
  }

  async scan(now = Date.now()): Promise<ReleaseReadinessReport> {
    const diagnostics: ReleaseDiagnostic[] = [];
    const [accounts, transactions, partners, inventoryItems, inventoryOpenings, inventoryMovements, profile, locks] = await this.database.transaction(
      'r',
      [
        this.database.accounts,
        this.database.transactions,
        this.database.partners,
        this.database.inventoryItems,
        this.database.inventoryOpenings,
        this.database.inventoryMovements,
        this.database.accountingProfiles,
        this.database.periodLocks,
      ],
      async () => Promise.all([
        this.database.accounts.toArray(),
        this.database.transactions.toArray(),
        this.database.partners.toArray(),
        this.database.inventoryItems.toArray(),
        this.database.inventoryOpenings.toArray(),
        this.database.inventoryMovements.toArray(),
        this.database.accountingProfiles.get('primary'),
        this.database.periodLocks.toArray(),
      ]),
    );

    const parsedProfile = profile ? AccountingProfileSchema.safeParse(profile) : null;
    if (!parsedProfile?.success) {
      diagnostics.push({
        code: 'INVALID_OR_MISSING_PROFILE',
        severity: 'ERROR',
        message: 'Hồ sơ TT58 chưa tồn tại hoặc không hợp lệ.',
      });
    } else if (!parsedProfile.data.taxProfileConfigured) {
      diagnostics.push({
        code: 'TAX_PROFILE_UNCONFIGURED',
        severity: 'WARNING',
        message: 'Hồ sơ phương pháp thuế chưa được xác nhận đầy đủ.',
      });
    }

    for (const account of accounts) {
      if (!account.kind) {
        diagnostics.push({
          code: 'ACCOUNT_KIND_MISSING',
          severity: 'ERROR',
          message: `Tài khoản ${account.name} chưa phân loại tiền mặt/tiền gửi.`,
          recordId: account.id,
        });
      }
    }

    const partnersById = new Map(partners.map((partner) => [partner.id, partner]));
    for (const tx of transactions) {
      if (!tx.partnerId) continue;
      const partner = partnersById.get(tx.partnerId);
      if (!partner) {
        diagnostics.push({
          code: 'TRANSACTION_PARTNER_MISSING',
          severity: 'ERROR',
          message: `Giao dịch ${tx.id} tham chiếu partner không tồn tại.`,
          recordId: tx.id,
        });
      } else if (!partnerSupportsTransaction(partner, tx.type)) {
        diagnostics.push({
          code: 'TRANSACTION_PARTNER_ROLE_MISMATCH',
          severity: 'ERROR',
          message: `Giao dịch ${tx.id} dùng partner ${partner.code} không đúng vai trò.`,
          recordId: tx.id,
        });
      }
    }

    const openingsByItem = new Map(inventoryOpenings.map((opening) => [opening.itemId, opening]));
    const itemIds = new Set(inventoryItems.map((item) => item.id));
    for (const item of inventoryItems) {
      if (!openingsByItem.has(item.id)) {
        diagnostics.push({
          code: 'INVENTORY_OPENING_MISSING',
          severity: 'ERROR',
          message: `Item ${item.code} chưa có opening tồn kho explicit.`,
          recordId: item.id,
        });
      }
    }
    for (const movement of inventoryMovements) {
      if (!itemIds.has(movement.itemId)) {
        diagnostics.push({
          code: 'INVENTORY_ITEM_MISSING',
          severity: 'ERROR',
          message: `Movement ${movement.id} tham chiếu item không tồn tại.`,
          recordId: movement.id,
        });
        continue;
      }
      const opening = openingsByItem.get(movement.itemId);
      if (opening && movement.date < opening.effectiveDate) {
        diagnostics.push({
          code: 'INVENTORY_MOVEMENT_BEFORE_OPENING',
          severity: 'ERROR',
          message: `Movement ${movement.id} có ngày trước opening của item.`,
          recordId: movement.id,
        });
      }
    }

    for (const lock of locks) {
      try {
        parseTt58ReportBundle(lock.reportSnapshotJson);
      } catch {
        diagnostics.push({
          code: 'LOCK_SNAPSHOT_INVALID',
          severity: 'ERROR',
          message: `Snapshot kỳ khóa ${lock.id} không đọc được.`,
          recordId: lock.id,
        });
      }
    }

    return {
      ready: diagnostics.every((item) => item.severity !== 'ERROR'),
      generatedAt: now,
      diagnostics,
      counts: {
        accounts: accounts.length,
        transactions: transactions.length,
        partners: partners.length,
        inventoryItems: inventoryItems.length,
        lockedPeriods: locks.filter((lock) => lock.status === 'LOCKED').length,
      },
    };
  }
}

export const releaseReadinessService = new ReleaseReadinessService(db);
