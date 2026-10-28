import { and, count, eq, isNull } from 'drizzle-orm';

import { getDb } from '../../db';
import { registeredDevices, systemSettings } from '../../db/schema';

export const MAX_DEVICES_KEY = 'maxDevicesPerUser';
export const DEFAULT_MAX_DEVICES = 2;
export const MAX_DEVICES_LIMIT = 10;

export type DeviceRecord = {
  id: string;
  userId: string;
  deviceTokenHash: string;
  name: string;
  userAgentSummary: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type DeviceStore = {
  listDevices(userId: string): Promise<DeviceRecord[]>;
  findDeviceByTokenHash(hash: string): Promise<DeviceRecord | null>;
  countActiveDevices(userId: string): Promise<number>;
  createDevice(input: {
    id: string;
    userId: string;
    deviceTokenHash: string;
    name: string;
    userAgentSummary: string | null;
  }): Promise<DeviceRecord>;
  touchDevice(id: string, now: Date): Promise<void>;
  revokeDevice(userId: string, id: string): Promise<boolean>;
  getMaxDevices(): Promise<number>;
  setMaxDevices(value: number): Promise<void>;
};

const deviceColumns = {
  id: registeredDevices.id,
  userId: registeredDevices.userId,
  deviceTokenHash: registeredDevices.deviceTokenHash,
  name: registeredDevices.name,
  userAgentSummary: registeredDevices.userAgentSummary,
  createdAt: registeredDevices.createdAt,
  lastSeenAt: registeredDevices.lastSeenAt,
  revokedAt: registeredDevices.revokedAt,
};

function createDrizzleDeviceStore(): DeviceStore {
  const db = () => getDb();
  const now = () => new Date();

  return {
    async listDevices(userId) {
      return db().select(deviceColumns).from(registeredDevices).where(eq(registeredDevices.userId, userId));
    },

    async findDeviceByTokenHash(hash) {
      const [row] = await db()
        .select(deviceColumns)
        .from(registeredDevices)
        .where(eq(registeredDevices.deviceTokenHash, hash))
        .limit(1);
      return row ?? null;
    },

    async countActiveDevices(userId) {
      const [row] = await db()
        .select({ value: count() })
        .from(registeredDevices)
        .where(and(eq(registeredDevices.userId, userId), isNull(registeredDevices.revokedAt)));
      return Number(row?.value ?? 0);
    },

    async createDevice(input) {
      const stamp = now();
      const [row] = await db()
        .insert(registeredDevices)
        .values({ ...input, createdAt: stamp, lastSeenAt: stamp })
        .returning(deviceColumns);
      return row;
    },

    async touchDevice(id, nowDate) {
      await db().update(registeredDevices).set({ lastSeenAt: nowDate }).where(eq(registeredDevices.id, id));
    },

    async revokeDevice(userId, id) {
      const [row] = await db()
        .update(registeredDevices)
        .set({ revokedAt: now() })
        .where(and(eq(registeredDevices.id, id), eq(registeredDevices.userId, userId), isNull(registeredDevices.revokedAt)))
        .returning({ id: registeredDevices.id });
      return Boolean(row);
    },

    async getMaxDevices() {
      const [row] = await db().select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, MAX_DEVICES_KEY)).limit(1);
      const parsed = row ? Number.parseInt(row.value, 10) : Number.NaN;
      return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_DEVICES_LIMIT) : DEFAULT_MAX_DEVICES;
    },

    async setMaxDevices(value) {
      const stamp = now();
      await db()
        .insert(systemSettings)
        .values({ key: MAX_DEVICES_KEY, value: String(value), updatedAt: stamp })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: String(value), updatedAt: stamp } });
    },
  };
}

let override: DeviceStore | null = null;

export function setDeviceStoreForTests(store: DeviceStore | null): void {
  override = store;
}

export function deviceStore(): DeviceStore {
  return override ?? createDrizzleDeviceStore();
}
