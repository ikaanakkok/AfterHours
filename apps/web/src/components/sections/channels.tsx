'use client';

import { useState } from 'react';
import { Mic, UserRound } from 'lucide-react';
import { Button, Notice, Panel, Status, formatTime, type SectionProps } from '../ui';

type Assessment = {
  checkedAt: string;
  mac: boolean;
  usb: { state: 'detected' | 'not_detected' | 'unknown'; iphoneCount: number };
  bluetooth: {
    state: 'on' | 'off' | 'unknown';
    knownIphoneCount: number;
    connectedIphoneCount: number;
  };
};

export function Voice({ command, busy }: SectionProps) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  async function assess() {
    const response = await command('voice.assess', {});
    if (response?.data?.bluetooth && response.data.usb)
      setAssessment(response.data as unknown as Assessment);
  }
  return (
    <div className="stack">
      <Notice variant="orange">
        WhatsApp connects through Baileys. Bluetooth is preferred for connecting a phone. Device
        detection and automatic call audio support are verified separately; automatic calling is not
        available yet.
      </Notice>
      <div className="grid-two">
        <Panel
          title="WhatsApp Calls"
          description="Baileys connection"
          action={<Status value="needs_attention" label="Live calls are not supported" />}
        >
          <div className="panel-body stack">
            <div className="row">
              <div className="list-icon">
                <Mic size={20} />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Connect your account by scanning the QR code in Front Desk Channels. Incoming and
                outgoing text messages are handled through Baileys.
              </p>
            </div>
            <p style={{ fontSize: 12 }}>
              The current Baileys version cannot answer live calls or stream call audio to AI. A
              working messaging connection does not mean live calls are supported. BlackHole is not
              used.
            </p>
          </div>
        </Panel>
        <Panel
          title="iPhone + Mac Calls"
          description="Bluetooth and Apple call relay"
          action={<Status value="awaiting_test" label="Real device test pending" />}
        >
          <div className="panel-body stack">
            <div className="row">
              <div className="list-icon">
                <UserRound size={20} />
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                Turn on Bluetooth on your iPhone and Mac. Apple call relay requires the same Apple
                Account and Wi-Fi network on both devices.
              </p>
            </div>
            <p style={{ fontSize: 12 }}>
              On iPhone: Settings → Apps → Phone → Calls on Other Devices. On Mac: FaceTime →
              Settings → Calls from iPhone. Select your Mac as an allowed device.
            </p>
            <p style={{ fontSize: 12 }}>
              Bluetooth pairing or a USB cable does not give AI access to call audio. Separately
              test answering a call manually on your Mac. Automatic answering and two-way audio are
              not implemented; caller ID is not authentication.
            </p>
          </div>
        </Panel>
      </div>
      <Panel title="Device Check" description="Check this Mac’s USB and Bluetooth device status">
        <div className="panel-body stack">
          <p className="muted" style={{ fontSize: 12 }}>
            This check only reads device status. It does not change phone settings or start a call.
            Seeing an iPhone entry does not verify the account or a phone call.
          </p>
          <div className="row">
            <Button disabled={!!busy} busy={busy === 'voice.assess'} onClick={() => void assess()}>
              Check device connection
            </Button>
          </div>
          {assessment && (
            <div className="stack" role="status" aria-live="polite">
              <p>Last checked: {formatTime(assessment.checkedAt)}</p>
              <p>Mac: {assessment.mac ? 'Detected' : 'This server is not a Mac'}</p>
              <p>
                Bluetooth:{' '}
                {assessment.bluetooth.state === 'on'
                  ? 'On'
                  : assessment.bluetooth.state === 'off'
                    ? 'Off'
                    : 'Could not read'}
              </p>
              <p>
                Known iPhones over Bluetooth: {assessment.bluetooth.knownIphoneCount} · Connected:{' '}
                {assessment.bluetooth.connectedIphoneCount}
              </p>
              <p>
                USB:{' '}
                {assessment.usb.state === 'unknown'
                  ? 'Could not read'
                  : assessment.usb.state === 'detected'
                    ? `${assessment.usb.iphoneCount} iPhone detected`
                    : 'No iPhone detected'}
              </p>
              <Notice variant="orange">
                Automatic calling is not available. Call relay on Mac and AI access to audio must be
                verified separately.
              </Notice>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            WhatsApp voice messages and direct call transfers to staff are not supported in this
            version.
          </p>
        </div>
      </Panel>
    </div>
  );
}
