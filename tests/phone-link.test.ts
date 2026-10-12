import { describe, expect, it } from 'vitest';
import { assessPhoneLink, parsePhoneHardware } from '../packages/core/src/phone-link.js';

describe('Mac phone link hardware evidence', () => {
  it('reports USB discovery and connected Bluetooth separately without disclosing identifiers', async () => {
    const result = await assessPhoneLink('darwin', async () => ({
      SPUSBDataType: [
        { _name: 'USB bus', _items: [{ _name: 'iPhone', serial_num: 'private-serial' }] },
      ],
      SPBluetoothDataType: [
        {
          controller_properties: {
            controller_state: 'attrib_on',
            controller_address: 'private-mac',
          },
          device_connected: [
            { 'iPhone 15': { device_address: 'private-address' } },
            { Headset: {} },
          ],
          device_not_connected: [{ 'iPhone 14': {} }, { iPad: {} }],
        },
      ],
    }));
    expect(result.usb).toEqual({ state: 'detected', iphoneCount: 1 });
    expect(result.bluetooth).toEqual({ state: 'on', connectedIphoneCount: 1, knownIphoneCount: 2 });
    expect(result.ready).toBe(false);
    expect(result.callAudioAvailable).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private|Headset|iPhone 15/);
  });
  it('does not turn a known disconnected device into an active call connection', () => {
    const result = parsePhoneHardware({
      SPUSBDataType: [],
      SPBluetoothDataType: [
        {
          controller_properties: { controller_state: 'attrib_on' },
          device_not_connected: [{ iPhone: {} }],
        },
      ],
    });
    expect(result.usb.state).toBe('not_detected');
    expect(result.bluetooth.connectedIphoneCount).toBe(0);
    expect(result.bluetooth.knownIphoneCount).toBe(1);
  });
  it('keeps unsupported hosts and failed OS inspection unknown', async () => {
    let reads = 0;
    const inspect = async () => {
      reads++;
      throw new Error('permission denied');
    };
    const unsupported = await assessPhoneLink('linux', inspect);
    expect(reads).toBe(0);
    expect(unsupported.mac).toBe(false);
    const failed = await assessPhoneLink('darwin', inspect);
    expect(reads).toBe(1);
    expect(failed.usb.state).toBe('unknown');
    expect(failed.bluetooth.state).toBe('unknown');
    expect(failed.callAudioAvailable).toBe(false);
    expect(
      parsePhoneHardware({ SPUSBDataType: 'invalid', SPBluetoothDataType: null }).usb.state,
    ).toBe('unknown');
  });
});
