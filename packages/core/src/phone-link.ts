import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
type Detection = 'detected' | 'not_detected' | 'unknown';
export interface PhoneLinkAssessment {
  checkedAt: string;
  mac: boolean;
  ready: false;
  preferredTransport: 'bluetooth';
  usb: { state: Detection; iphoneCount: number };
  bluetooth: {
    state: 'on' | 'off' | 'unknown';
    knownIphoneCount: number;
    connectedIphoneCount: number;
  };
  callRelay: 'requires_manual_verification';
  callAudioAvailable: false;
  blackHoleRequired: false;
  whatsapp: { transport: 'baileys'; textAvailable: true; liveCallsAvailable: false };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Names are discovery hints only. Do not return names, addresses, serials or raw profiler output.
export function parsePhoneHardware(value: unknown): Pick<PhoneLinkAssessment, 'usb' | 'bluetooth'> {
  const root = record(value);
  const usb = root?.SPUSBDataType;
  const bluetooth = root?.SPBluetoothDataType;
  let iphoneCount = 0;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    const node = record(value);
    if (!node) return;
    if (typeof node._name === 'string' && /^iPhone(?:\b|$)/i.test(node._name)) iphoneCount++;
    if (Array.isArray(node._items)) visit(node._items);
  };
  visit(usb);
  let state: 'on' | 'off' | 'unknown' = 'unknown';
  let connectedIphoneCount = 0;
  let knownIphoneCount = 0;
  if (Array.isArray(bluetooth)) {
    for (const item of bluetooth) {
      const controller = record(item);
      const properties = record(controller?.controller_properties);
      if (properties?.controller_state === 'attrib_on') state = 'on';
      else if (properties?.controller_state === 'attrib_off' && state !== 'on') state = 'off';
      const count = (devices: unknown) =>
        Array.isArray(devices)
          ? devices.reduce<number>((total, device) => {
              const entries = record(device);
              return (
                total +
                (entries
                  ? Object.keys(entries).filter((name) => /\biPhone\b/i.test(name)).length
                  : 0)
              );
            }, 0)
          : 0;
      connectedIphoneCount += count(controller?.device_connected);
      knownIphoneCount +=
        count(controller?.device_connected) + count(controller?.device_not_connected);
    }
  }
  return {
    usb: {
      state: Array.isArray(usb) ? (iphoneCount ? 'detected' : 'not_detected') : 'unknown',
      iphoneCount,
    },
    bluetooth: { state, knownIphoneCount, connectedIphoneCount },
  };
}

export async function assessPhoneLink(
  platform = process.platform,
  inspect: () => Promise<unknown> = async () => {
    const result = await run(
      '/usr/sbin/system_profiler',
      ['SPUSBDataType', 'SPBluetoothDataType', '-json', '-detailLevel', 'mini'],
      {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return JSON.parse(result.stdout) as unknown;
  },
): Promise<PhoneLinkAssessment> {
  let hardware = parsePhoneHardware(null);
  if (platform === 'darwin') {
    try {
      hardware = parsePhoneHardware(await inspect());
    } catch {
      // Missing OS permissions, timeouts and malformed data must stay unknown.
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    mac: platform === 'darwin',
    ready: false,
    preferredTransport: 'bluetooth',
    ...hardware,
    callRelay: 'requires_manual_verification',
    callAudioAvailable: false,
    blackHoleRequired: false,
    whatsapp: { transport: 'baileys', textAvailable: true, liveCallsAvailable: false },
  };
}
