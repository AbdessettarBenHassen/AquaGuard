// Bluetooth (BLE GATT) contract between an AquaGuard node (ESP32 firmware) and
// the phone. Bluetooth is used ONLY to link a node and give it the home Wi-Fi:
// the node then sends its data to the server by itself over Wi-Fi.
// See docs/FIRMWARE.md for the full spec given to the firmware team.

export const GG_SERVICE_UUID = 'a9a00001-8f1b-4c7e-9d3a-2b5f8a0c0001';
/** Nodes advertise with this name prefix, e.g. "AquaGuard AG-7F3A21". */
export const GG_NAME_PREFIX = 'AquaGuard';

export const GG_CHAR = {
  /** read: UTF-8 JSON {"id":"AG-7F3A21","claim":"483920","fw":"0.1.0"} */
  identity: 'a9a00005-8f1b-4c7e-9d3a-2b5f8a0c0001',
  /** write (with response): UTF-8 JSON {"key":"<device key>","api":"https://…"}; node stores it in flash */
  provision: 'a9a00006-8f1b-4c7e-9d3a-2b5f8a0c0001',
  /** notify: 1 byte DeviceEvent */
  event: 'a9a00003-8f1b-4c7e-9d3a-2b5f8a0c0001',
  /** write: 1 byte Command */
  control: 'a9a00004-8f1b-4c7e-9d3a-2b5f8a0c0001',
  /** write (with response): UTF-8 JSON {"mode":"wifi","ssid":"…","pass":"…"}  */
  network: 'a9a00007-8f1b-4c7e-9d3a-2b5f8a0c0001',
} as const;

export enum DeviceEvent {
  None = 0,
  /** Someone pressed the node button while it was in "identify" mode. */
  PairConfirm = 5,
  /** Provisioning saved and the node reached the server. */
  ProvisionOk = 6,
  /** Provisioning saved but the node could not reach the server yet. */
  ProvisionNoNetwork = 7,
  /** New Wi-Fi saved and connected. */
  WifiOk = 8,
  /** New Wi-Fi saved but the node could not connect (password, range, 5 GHz). */
  WifiFail = 9,
  /** Wi-Fi change refused: the node button was not pressed. */
  WifiDenied = 10,
}

export enum Command {
  /** Blink + buzz and wait for a button press (proves which node it is). */
  Identify = 1,
  /** Forget the device key (factory reset of the link). */
  Unprovision = 2,
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** BLE libraries exchange characteristic values as base64. */
export function toBase64(text: string) {
  const bytes = enc.encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function fromBase64(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

export interface NodeIdentity {
  id: string;
  claim: string;
  fw?: string;
  /** Current network. */
  net?: { mode: 'wifi'; ssid?: string; on?: boolean };
}

export function parseIdentity(b64: string): NodeIdentity {
  const j = JSON.parse(fromBase64(b64)) as NodeIdentity;
  if (!j.id || !j.claim) throw new Error('Sensor identity is incomplete');
  return j;
}
