import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from './Logger';

const STORAGE_KEY = '@dapp_connection_history';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_RECORDS = 300;
const MAX_STORAGE_CHARS = 500_000;
const MAX_NAME_LENGTH = 128;
const MAX_URL_LENGTH = 2048;
const Q40_ADDRESS = /^Q[0-9a-fA-F]{40}$/;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  private loadPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  private sanitizeRecord(record: DAppConnectionRecord): DAppConnectionRecord {
    return {
      ...record,
      channelId: record.channelId.slice(0, 36),
      name: record.name.slice(0, MAX_NAME_LENGTH),
      url: record.url.slice(0, MAX_URL_LENGTH),
      connectedAccount: record.connectedAccount.slice(0, 41),
    };
  }

  private isStoredRecord(value: unknown): value is DAppConnectionRecord {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<DAppConnectionRecord>;
    return (
      typeof record.channelId === 'string' &&
      CHANNEL_ID_PATTERN.test(record.channelId) &&
      typeof record.name === 'string' &&
      record.name.length > 0 &&
      record.name.length <= MAX_NAME_LENGTH &&
      typeof record.url === 'string' &&
      record.url.length <= MAX_URL_LENGTH &&
      typeof record.connectedAccount === 'string' &&
      Q40_ADDRESS.test(record.connectedAccount) &&
      typeof record.connectedAt === 'number' &&
      Number.isSafeInteger(record.connectedAt) &&
      record.connectedAt >= 0 &&
      (record.disconnectedAt === null ||
        (typeof record.disconnectedAt === 'number' &&
          Number.isSafeInteger(record.disconnectedAt) &&
          record.disconnectedAt >= 0)) &&
      typeof record.explicitlyDisconnected === 'boolean'
    );
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
    if (this.loadPromise) return this.loadPromise;

    const load = (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        if (raw.length > MAX_STORAGE_CHARS) {
          Logger.warn('DAppConnectionStore', 'Stored history too large, resetting');
          this.records = [];
          await AsyncStorage.removeItem(STORAGE_KEY);
        } else {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            Logger.warn('DAppConnectionStore', 'Stored history is malformed, resetting');
            this.records = [];
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
          if (Array.isArray(parsed)) {
            this.records = parsed
              .filter((r) => this.isStoredRecord(r))
              .map((r) => this.sanitizeRecord(r));
          } else if (parsed !== undefined) {
            this.records = [];
          }
        }
      }
      this.trimRecords();
      this.loaded = true;
      // Clean up expired on load
      await this.cleanExpired();
    })();
    const inFlight = load.catch((err) => {
      Logger.error('DAppConnectionStore', 'Failed to load:', err);
      this.records = [];
      this.loaded = false;
      throw err;
    });
    this.loadPromise = inFlight;
    try {
      await inFlight;
    } finally {
      if (this.loadPromise === inFlight) this.loadPromise = null;
    }
  }

  /** Persist records to AsyncStorage */
  private async save(): Promise<void> {
    try {
      const serialized = JSON.stringify(this.records);
      if (serialized.length > MAX_STORAGE_CHARS) {
        throw new Error('dApp connection history exceeds its storage budget');
      }
      await AsyncStorage.setItem(STORAGE_KEY, serialized);
      if ((await AsyncStorage.getItem(STORAGE_KEY)) !== serialized) {
        throw new Error('dApp connection history persistence could not be confirmed');
      }
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
      Logger.debug(
        'DAppConnectionStore',
        `Cleaned ${before - this.records.length} expired records`
      );
      await this.save();
    }
  }

  /** Add or update a connection when a dApp connects */
  async onConnected(
    record: Omit<DAppConnectionRecord, 'disconnectedAt' | 'explicitlyDisconnected'>
  ): Promise<void> {
    if (!Q40_ADDRESS.test(record.connectedAccount)) {
      throw new Error('Invalid dApp connected account');
    }
    if (
      !CHANNEL_ID_PATTERN.test(record.channelId) ||
      typeof record.name !== 'string' ||
      record.name.length === 0 ||
      record.name.length > MAX_NAME_LENGTH ||
      typeof record.url !== 'string' ||
      record.url.length > MAX_URL_LENGTH ||
      !Number.isSafeInteger(record.connectedAt) ||
      record.connectedAt < 0
    ) {
      throw new Error('Invalid dApp connection record');
    }
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
    if (!CHANNEL_ID_PATTERN.test(channelId)) throw new Error('Invalid dApp channel ID');
    await this.queueWrite(async () => {
      await this.load();

      const record = this.records.find((r) => r.channelId === channelId);
      if (record) {
        record.disconnectedAt = Date.now();
        record.explicitlyDisconnected = record.explicitlyDisconnected || explicit;
        await this.save();
      }
    });
  }

  /** Remove a specific connection record */
  async remove(channelId: string): Promise<void> {
    if (!CHANNEL_ID_PATTERN.test(channelId)) throw new Error('Invalid dApp channel ID');
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
      try {
        await this.load();
      } catch {
        this.records = [];
        this.loaded = true;
      }
      this.records = [];
      await this.save();
    });
  }
}

export default new DAppConnectionStore();
