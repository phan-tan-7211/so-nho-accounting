import { z } from 'zod';
import type { AccountingDB } from './db';
import { db } from './db';
import { AccountSchema, AuditLogSchema, TransactionSchema } from './models';
import { AccountingProfileSchema } from './accountingProfile';
import { TaxOpeningPositionSchema } from './taxOpeningPosition';
import { InventoryItemSchema, InventoryMovementSchema, InventoryOpeningSchema } from './inventory';
import { PartnerSchema } from './partners';
import {
  LEGACY_OPENING_BALANCE_MIGRATION_ID,
} from './accountingCutoverPersistence';
import {
  LEGACY_OPENING_BALANCE_MIGRATION_VERSION,
  OpeningEffectKind,
} from './legacyOpeningBalanceMigration';

export const BACKUP_FORMAT = 'SO_NHO_ACCOUNTING_BACKUP' as const;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const CURRENT_DATABASE_VERSION = 7 as const;

const OpeningCashEffectSchema = z.object({
  kind: z.literal(OpeningEffectKind.OPENING_CASH),
  accountId: z.string().uuid(),
  amount: z.number().int(),
});

const OpeningEffectRecordSchema = OpeningCashEffectSchema.extend({
  id: z.string().min(1),
  migrationId: z.literal(LEGACY_OPENING_BALANCE_MIGRATION_ID),
  migrationVersion: z.literal(LEGACY_OPENING_BALANCE_MIGRATION_VERSION),
});

const MigrationStateSchema = z.object({
  id: z.literal(LEGACY_OPENING_BALANCE_MIGRATION_ID),
  version: z.literal(LEGACY_OPENING_BALANCE_MIGRATION_VERSION),
  sourceSignature: z.string().min(1),
  openingEffects: z.array(OpeningCashEffectSchema),
  legacyTransactionIds: z.array(z.string().uuid()),
});

const PeriodLockRecordSchema = z.object({
  id: z.string().min(1),
  periodStart: z.number().int().nonnegative(),
  periodEnd: z.number().int().nonnegative(),
  status: z.enum(['LOCKED', 'UNLOCKED']),
  revision: z.number().int().positive(),
  lockedAt: z.number().int().nonnegative(),
  unlockedAt: z.number().int().nonnegative().optional(),
  reportSnapshotJson: z.string(),
});

const PeriodLockEventSchema = z.object({
  id: z.string().uuid(),
  periodLockId: z.string().min(1),
  action: z.enum(['LOCK', 'UNLOCK']),
  revision: z.number().int().positive(),
  timestamp: z.number().int().nonnegative(),
});

export interface BackupData {
  accounts: unknown[];
  transactions: unknown[];
  auditLogs: unknown[];
  accountingProfiles: unknown[];
  openingEffects: unknown[];
  migrationStates: unknown[];
  taxOpeningPositions: unknown[];
  periodLocks: unknown[];
  periodLockEvents: unknown[];
  inventoryItems: unknown[];
  inventoryOpenings: unknown[];
  inventoryMovements: unknown[];
  partners: unknown[];
}

export type BackupTableName = keyof BackupData;

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  databaseVersion: typeof CURRENT_DATABASE_VERSION;
  createdAt: number;
  data: BackupData;
  checksumSha256: string;
}

export interface BackupPreview {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  databaseVersion: typeof CURRENT_DATABASE_VERSION;
  createdAt: number;
  checksumSha256: string;
  counts: Record<BackupTableName, number>;
  totalRecords: number;
  lockedPeriods: number;
}

interface ParsedBackupData {
  accounts: z.infer<typeof AccountSchema>[];
  transactions: z.infer<typeof TransactionSchema>[];
  auditLogs: z.infer<typeof AuditLogSchema>[];
  accountingProfiles: z.infer<typeof AccountingProfileSchema>[];
  openingEffects: z.infer<typeof OpeningEffectRecordSchema>[];
  migrationStates: z.infer<typeof MigrationStateSchema>[];
  taxOpeningPositions: z.infer<typeof TaxOpeningPositionSchema>[];
  periodLocks: z.infer<typeof PeriodLockRecordSchema>[];
  periodLockEvents: z.infer<typeof PeriodLockEventSchema>[];
  inventoryItems: z.infer<typeof InventoryItemSchema>[];
  inventoryOpenings: z.infer<typeof InventoryOpeningSchema>[];
  inventoryMovements: z.infer<typeof InventoryMovementSchema>[];
  partners: z.infer<typeof PartnerSchema>[];
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = sortJson(source[key]);
    return result;
  }
  return value;
}

export function canonicalBackupPayload(value: Omit<BackupEnvelope, 'checksumSha256'>): string {
  return JSON.stringify(sortJson(value));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseArray<T>(value: unknown, schema: z.ZodType<T>, label: string): T[] {
  const result = z.array(schema).safeParse(value);
  if (!result.success) throw new Error(`Backup table ${label} is invalid`);
  return result.data;
}

function parseBackupData(data: BackupData): ParsedBackupData {
  return {
    accounts: parseArray(data.accounts, AccountSchema, 'accounts'),
    transactions: parseArray(data.transactions, TransactionSchema, 'transactions'),
    auditLogs: parseArray(data.auditLogs, AuditLogSchema, 'auditLogs'),
    accountingProfiles: parseArray(data.accountingProfiles, AccountingProfileSchema, 'accountingProfiles'),
    openingEffects: parseArray(data.openingEffects, OpeningEffectRecordSchema, 'openingEffects'),
    migrationStates: parseArray(data.migrationStates, MigrationStateSchema, 'migrationStates'),
    taxOpeningPositions: parseArray(data.taxOpeningPositions, TaxOpeningPositionSchema, 'taxOpeningPositions'),
    periodLocks: parseArray(data.periodLocks, PeriodLockRecordSchema, 'periodLocks'),
    periodLockEvents: parseArray(data.periodLockEvents, PeriodLockEventSchema, 'periodLockEvents'),
    inventoryItems: parseArray(data.inventoryItems, InventoryItemSchema, 'inventoryItems'),
    inventoryOpenings: parseArray(data.inventoryOpenings, InventoryOpeningSchema, 'inventoryOpenings'),
    inventoryMovements: parseArray(data.inventoryMovements, InventoryMovementSchema, 'inventoryMovements'),
    partners: parseArray(data.partners, PartnerSchema, 'partners'),
  };
}

const BackupEnvelopeInputSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  databaseVersion: z.literal(CURRENT_DATABASE_VERSION),
  createdAt: z.number().int().nonnegative(),
  data: z.object({
    accounts: z.array(z.unknown()),
    transactions: z.array(z.unknown()),
    auditLogs: z.array(z.unknown()),
    accountingProfiles: z.array(z.unknown()),
    openingEffects: z.array(z.unknown()),
    migrationStates: z.array(z.unknown()),
    taxOpeningPositions: z.array(z.unknown()),
    periodLocks: z.array(z.unknown()),
    periodLockEvents: z.array(z.unknown()),
    inventoryItems: z.array(z.unknown()),
    inventoryOpenings: z.array(z.unknown()),
    inventoryMovements: z.array(z.unknown()),
    partners: z.array(z.unknown()),
  }),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

function buildPreview(envelope: BackupEnvelope, parsed: ParsedBackupData): BackupPreview {
  const counts: Record<BackupTableName, number> = {
    accounts: parsed.accounts.length,
    transactions: parsed.transactions.length,
    auditLogs: parsed.auditLogs.length,
    accountingProfiles: parsed.accountingProfiles.length,
    openingEffects: parsed.openingEffects.length,
    migrationStates: parsed.migrationStates.length,
    taxOpeningPositions: parsed.taxOpeningPositions.length,
    periodLocks: parsed.periodLocks.length,
    periodLockEvents: parsed.periodLockEvents.length,
    inventoryItems: parsed.inventoryItems.length,
    inventoryOpenings: parsed.inventoryOpenings.length,
    inventoryMovements: parsed.inventoryMovements.length,
    partners: parsed.partners.length,
  };
  return {
    formatVersion: envelope.formatVersion,
    databaseVersion: envelope.databaseVersion,
    createdAt: envelope.createdAt,
    checksumSha256: envelope.checksumSha256,
    counts,
    totalRecords: Object.values(counts).reduce((sum, value) => sum + value, 0),
    lockedPeriods: parsed.periodLocks.filter((record) => record.status === 'LOCKED').length,
  };
}

export class DataBackupService {
  private readonly database: AccountingDB;

  constructor(database: AccountingDB) {
    this.database = database;
  }

  private tables() {
    return [
      this.database.accounts,
      this.database.transactions,
      this.database.auditLogs,
      this.database.accountingProfiles,
      this.database.openingEffects,
      this.database.migrationStates,
      this.database.taxOpeningPositions,
      this.database.periodLocks,
      this.database.periodLockEvents,
      this.database.inventoryItems,
      this.database.inventoryOpenings,
      this.database.inventoryMovements,
      this.database.partners,
    ] as const;
  }

  async exportEnvelope(now = Date.now()): Promise<BackupEnvelope> {
    const data = await this.database.transaction('r', [...this.tables()], async (): Promise<BackupData> => ({
      accounts: await this.database.accounts.toArray(),
      transactions: await this.database.transactions.toArray(),
      auditLogs: await this.database.auditLogs.toArray(),
      accountingProfiles: await this.database.accountingProfiles.toArray(),
      openingEffects: await this.database.openingEffects.toArray(),
      migrationStates: await this.database.migrationStates.toArray(),
      taxOpeningPositions: await this.database.taxOpeningPositions.toArray(),
      periodLocks: await this.database.periodLocks.toArray(),
      periodLockEvents: await this.database.periodLockEvents.toArray(),
      inventoryItems: await this.database.inventoryItems.toArray(),
      inventoryOpenings: await this.database.inventoryOpenings.toArray(),
      inventoryMovements: await this.database.inventoryMovements.toArray(),
      partners: await this.database.partners.toArray(),
    }));
    const unsigned = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      databaseVersion: CURRENT_DATABASE_VERSION,
      createdAt: now,
      data,
    } as const;
    return { ...unsigned, checksumSha256: await sha256Hex(canonicalBackupPayload(unsigned)) };
  }

  async exportJson(now = Date.now()): Promise<string> {
    return `${JSON.stringify(await this.exportEnvelope(now), null, 2)}\n`;
  }

  async verifyJson(json: string): Promise<{ envelope: BackupEnvelope; parsed: ParsedBackupData }> {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new Error('Backup JSON is malformed');
    }
    const result = BackupEnvelopeInputSchema.safeParse(raw);
    if (!result.success) throw new Error('Backup envelope/version is unsupported or invalid');
    const envelope = result.data as BackupEnvelope;
    const { checksumSha256: _checksum, ...unsigned } = envelope;
    const actual = await sha256Hex(canonicalBackupPayload(unsigned));
    if (actual !== envelope.checksumSha256) throw new Error('Backup checksum does not match; file may be corrupted or modified');
    return { envelope, parsed: parseBackupData(envelope.data) };
  }

  async previewJson(json: string): Promise<BackupPreview> {
    const { envelope, parsed } = await this.verifyJson(json);
    return buildPreview(envelope, parsed);
  }

  async restoreJson(json: string): Promise<BackupEnvelope> {
    const { envelope, parsed } = await this.verifyJson(json);
    await this.database.transaction('rw', [...this.tables()], async () => {
      for (const table of this.tables()) await table.clear();
      await this.database.accounts.bulkPut(parsed.accounts);
      await this.database.transactions.bulkPut(parsed.transactions);
      await this.database.auditLogs.bulkPut(parsed.auditLogs);
      await this.database.accountingProfiles.bulkPut(parsed.accountingProfiles);
      await this.database.openingEffects.bulkPut(parsed.openingEffects);
      await this.database.migrationStates.bulkPut(parsed.migrationStates);
      await this.database.taxOpeningPositions.bulkPut(parsed.taxOpeningPositions);
      await this.database.periodLocks.bulkPut(parsed.periodLocks);
      await this.database.periodLockEvents.bulkPut(parsed.periodLockEvents);
      await this.database.inventoryItems.bulkPut(parsed.inventoryItems);
      await this.database.inventoryOpenings.bulkPut(parsed.inventoryOpenings);
      await this.database.inventoryMovements.bulkPut(parsed.inventoryMovements);
      await this.database.partners.bulkPut(parsed.partners);
    });
    return envelope;
  }
}

export const dataBackupService = new DataBackupService(db);
