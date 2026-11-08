import Constants, { ExecutionEnvironment } from 'expo-constants';
import { PermissionsAndroid, Platform } from 'react-native';

import { t } from '../i18n';
import {
  Command,
  DeviceEvent,
  GG_CHAR,
  GG_NAME_PREFIX,
  GG_SERVICE_UUID,
  fromBase64,
  parseIdentity,
  toBase64,
  type NodeIdentity,
} from './protocol';

// Real node linking over Bluetooth (react-native-ble-plx).
// Only works in the installed app (APK), not in Expo Go, so the native
// module is loaded lazily and every entry point reports availability.

type BleModule = typeof import('react-native-ble-plx');
type BleManager = import('react-native-ble-plx').BleManager;
type Device = import('react-native-ble-plx').Device;

let mod: BleModule | null = null;
let manager: BleManager | null = null;

export function bluetoothAvailable() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must not load in Expo Go
    mod = mod ?? (require('react-native-ble-plx') as BleModule);
    manager = manager ?? new mod.BleManager();
    return true;
  } catch {
    return false;
  }
}

async function ensurePermissions() {
  if (Platform.OS !== 'android') return;
  const api = Number(Platform.Version);
  const perms =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(perms);
  if (Object.values(res).some((r) => r !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error(t('ble.permission'));
  }
}

async function ensurePoweredOn() {
  const state = await manager!.state();
  if (state === 'PoweredOn') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error(t('ble.turnOn')));
    }, 8000);
    const sub = manager!.onStateChange((s) => {
      if (s === 'PoweredOn') {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    }, true);
  });
}

export interface FoundNode {
  id: string; // BLE address / identifier
  name: string;
  rssi: number | null;
}

/** Scans for nearby AquaGuard nodes. Returns a stop function. */
export async function scanNodes(onFound: (b: FoundNode) => void, onError: (e: Error) => void) {
  if (!bluetoothAvailable()) throw new Error(t('ble.needApp'));
  await ensurePermissions();
  await ensurePoweredOn();
  manager!.startDeviceScan([GG_SERVICE_UUID], { allowDuplicates: false }, (err, device) => {
    if (err) {
      onError(new Error(err.message));
      return;
    }
    if (!device) return;
    const name = device.name ?? device.localName ?? '';
    onFound({ id: device.id, name: name || `${GG_NAME_PREFIX} node`, rssi: device.rssi });
  });
  return () => manager?.stopDeviceScan();
}

/** Scans until the node with this ID shows up (its name ends with the ID). */
export async function findNode(deviceId: string, timeoutMs = 15000): Promise<FoundNode> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => {
      stop?.();
      reject(new Error(t('ble.notFound', { id: deviceId })));
    }, timeoutMs);
    scanNodes(
      (b) => {
        if (!b.name.toUpperCase().includes(deviceId.toUpperCase())) return;
        clearTimeout(timer);
        stop?.();
        resolve(b);
      },
      (e) => {
        clearTimeout(timer);
        stop?.();
        reject(e);
      },
    ).then((s) => (stop = s), (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export interface BleSession {
  identity: NodeIdentity;
  /** Makes the node blink/buzz and resolves when someone presses its button. */
  waitForButton(timeoutMs?: number): Promise<void>;
  /** Writes the device key + server address into the node. */
  provision(key: string, apiUrl: string): Promise<'ok' | 'no-network' | 'unknown'>;
  /** Sends a Wi-Fi network (call waitForButton first on a linked node). */
  setWifi(ssid: string, pass: string): Promise<'ok' | 'fail' | 'denied' | 'unsupported' | 'unknown'>;
  close(): Promise<void>;
}

/** Connects to a node found by the scan and reads its identity. */
export async function connectNode(bleId: string): Promise<BleSession> {
  if (!bluetoothAvailable()) throw new Error(t('ble.needApp'));
  manager!.stopDeviceScan();
  let device: Device = await manager!.connectToDevice(bleId, { timeout: 12000 });
  if (Platform.OS === 'android') device = await device.requestMTU(247);
  device = await device.discoverAllServicesAndCharacteristics();
  const idChar = await device.readCharacteristicForService(GG_SERVICE_UUID, GG_CHAR.identity);
  const identity = parseIdentity(idChar.value ?? '');

  const nextEvent = (want: DeviceEvent[], timeoutMs: number) =>
    new Promise<DeviceEvent | null>((resolve) => {
      const timer = setTimeout(() => {
        sub.remove();
        resolve(null);
      }, timeoutMs);
      const sub = device.monitorCharacteristicForService(GG_SERVICE_UUID, GG_CHAR.event, (err, ch) => {
        if (err || !ch?.value) return;
        const code = fromBase64(ch.value).charCodeAt(0) as DeviceEvent;
        if (want.includes(code)) {
          clearTimeout(timer);
          sub.remove();
          resolve(code);
        }
      });
    });

  return {
    identity,
    async waitForButton(timeoutMs = 45000) {
      const pressed = nextEvent([DeviceEvent.PairConfirm], timeoutMs);
      await device.writeCharacteristicWithResponseForService(GG_SERVICE_UUID, GG_CHAR.control, toBase64(String.fromCharCode(Command.Identify)));
      if ((await pressed) == null) throw new Error(t('ble.noPress'));
    },
    async provision(key, apiUrl) {
      const result = nextEvent([DeviceEvent.ProvisionOk, DeviceEvent.ProvisionNoNetwork], 20000);
      await device.writeCharacteristicWithResponseForService(GG_SERVICE_UUID, GG_CHAR.provision, toBase64(JSON.stringify({ key, api: apiUrl })));
      const r = await result;
      return r === DeviceEvent.ProvisionOk ? 'ok' : r === DeviceEvent.ProvisionNoNetwork ? 'no-network' : 'unknown';
    },
    async setWifi(ssid, pass) {
      const chars = await device.characteristicsForService(GG_SERVICE_UUID);
      if (!chars.some((c) => c.uuid.toLowerCase() === GG_CHAR.network)) return 'unsupported';
      // the node tries the network for up to ~10 s before answering
      const result = nextEvent([DeviceEvent.WifiOk, DeviceEvent.WifiFail, DeviceEvent.WifiDenied], 25000);
      await device.writeCharacteristicWithResponseForService(GG_SERVICE_UUID, GG_CHAR.network, toBase64(JSON.stringify({ mode: 'wifi', ssid, pass })));
      const r = await result;
      return r === DeviceEvent.WifiOk ? 'ok' : r === DeviceEvent.WifiFail ? 'fail' : r === DeviceEvent.WifiDenied ? 'denied' : 'unknown';
    },
    async close() {
      await device.cancelConnection().catch(() => {});
    },
  };
}
