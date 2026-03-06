import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from './Logger';

const STORAGE_KEY = '@dapp_connection_history';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_RECORDS = 300;
const MAX_STORAGE_CHARS = 500_000;
const MAX_FIELD_LENGTH = 256;

export interface DAppConnectionRecord {
  channelId: string;
  name: string;
  url: string;
  connectedAccount: string;
  connectedAt: number;
  disconnectedAt: number | null;
  explicitlyDisconnected: boolean;
}

class DAppConnectionStore {
  private records: DAppConnectionRecord[] = [];
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  private clampText(value: string): string {
    return value.slice(0, MAX_FIELD_LENGTH);
  }

  private sanitizeRecord(record: DAppConnectionRecord): DAppConnectionRecord {
    return {
      ...record,
      channelId: this.clampText(record.channelId),
      name: this.clampText(record.name),
      url: this.clampText(record.url),
      connectedAccount: this.clampText(record.connectedAccount),
    };
  }

  private trimRecords(): void {
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(0, MAX_RECORDS);
    }
  }

  private async queueWrite(task: () => Promise<void>): Promise<void> {
    const run = this.writeChain
      .catch(() => undefined)
      .then(task)
      .catch((err) => {
        Logger.error('DAppConnectionStore', 'Write operation failed:', err);
        throw err;
      });
    this.writeChain = run;
    return run;
  }

  /** Load records from AsyncStorage */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        if (raw.length > MAX_STORAGE_CHARS) {
          Logger.warn('DAppConnectionStore', 'Stored history too large, resetting');
          this.records = [];
          await AsyncStorage.removeItem(STORAGE_KEY);
        } else {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.records = parsed
              .filter((r) => r && typeof r === 'object' && typeof r.channelId === 'string')
              .map((r) => this.sanitizeRecord(r as DAppConnectionRecord));
          } else {
            this.records = [];
          }
        }
      }
      this.trimRecords();
      this.loaded = true;
      // Clean up expired on load
      await this.cleanExpired();
    } catch (err) {
      Logger.error('DAppConnectionStore', 'Failed to load:', err);
      this.records = [];
      this.loaded = true;
    }
  }

  /** Persist records to AsyncStorage */
  private async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch (err) {
      Logger.error('DAppConnectionStore', 'Failed to save:', err);
      throw err;
    }
  }

  /** Remove records older than 30 days (from disconnectedAt) */
  private async cleanExpired(): Promise<void> {
    const now = Date.now();
    const before = this.records.length;
    this.records = this.records.filter((r) => {
      if (r.disconnectedAt === null) return true; // still active
      return now - r.disconnectedAt < TTL_MS;
    });
    if (this.records.length !== before) {
      Logger.debug('DAppConnectionStore', `Cleaned ${before - this.records.length} expired records`);
      await this.save();
    }
  }

  /** Add or update a connection when a dApp connects */
  async onConnected(record: Omit<DAppConnectionRecord, 'disconnectedAt' | 'explicitlyDisconnected'>): Promise<void> {
    await this.queueWrite(async () => {
      await this.load();

      const existing = this.records.findIndex((r) => r.channelId === record.channelId);
      const entry = this.sanitizeRecord({
        ...record,
        disconnectedAt: null,
        explicitlyDisconnected: false,
      });

      if (existing >= 0) {
        this.records[existing] = entry;
      } else {
        this.records.unshift(entry); // newest first
      }
      this.trimRecords();
      await this.save();
    });
  }

  /** Mark a connection as disconnected */
  async onDisconnected(channelId: string, explicit: boolean): Promise<void> {
    await this.queueWrite(async () => {
      await this.load();

      const record = this.records.find((r) => r.channelId === channelId);
      if (record) {
        record.disconnectedAt = Date.now();
        record.explicitlyDisconnected = explicit;
        await this.save();
      }
    });
  }

  /** Remove a specific connection record */
  async remove(channelId: string): Promise<void> {
    await this.queueWrite(async () => {
      await this.load();
      this.records = this.records.filter((r) => r.channelId !== channelId);
      await this.save();
    });
  }

  /** Get all records */
  async getAll(): Promise<DAppConnectionRecord[]> {
    await this.load();
    return [...this.records];
  }

  /** Get active (connected) records */
  async getActive(): Promise<DAppConnectionRecord[]> {
    await this.load();
    return this.records.filter((r) => r.disconnectedAt === null);
  }

  /** Get disconnected (past) records */
  async getRecent(): Promise<DAppConnectionRecord[]> {
    await this.load();
    return this.records.filter((r) => r.disconnectedAt !== null);
  }

  /** Count of active connections */
  async activeCount(): Promise<number> {
    await this.load();
    return this.records.filter((r) => r.disconnectedAt === null).length;
  }

  /** Clear all records */
  async clear(): Promise<void> {
    await this.queueWrite(async () => {
      this.records = [];
      await this.save();
    });
  }
}

export default new DAppConnectionStore();
