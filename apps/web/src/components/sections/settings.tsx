'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { BusinessConfig } from '@afterhours/core';
import {
  Button,
  Checkbox,
  field,
  Input,
  Notice,
  Panel,
  Select,
  TextArea,
  type SectionProps,
} from '../ui';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function HoursEditor({
  value,
  onChange,
  calendar = false,
}: {
  value: BusinessConfig['activeHours'];
  onChange: (next: BusinessConfig['activeHours']) => void;
  calendar?: boolean;
}) {
  return (
    <fieldset>
      <legend>{calendar ? 'Calendar business hours' : 'AI customer communication hours'}</legend>
      <div className="form-stack">
        <div className="row wrap">
          <Button
            small
            onClick={() =>
              onChange(
                [0, 1, 2, 3, 4, 5, 6].map((day) => ({
                  day,
                  start: '00:00',
                  end: '24:00',
                })),
              )
            }
          >
            Every day, all day
          </Button>
          <Button
            small
            onClick={() =>
              onChange(
                calendar
                  ? [1, 2, 3, 4, 5].map((day) => ({
                      day,
                      start: '09:00',
                      end: '18:00',
                    }))
                  : [
                      ...[1, 2, 3, 4, 5].map((day) => ({
                        day,
                        start: '18:00',
                        end: '09:00',
                      })),
                      { day: 6, start: '00:00', end: '24:00' },
                      { day: 0, start: '00:00', end: '24:00' },
                    ],
              )
            }
          >
            {calendar ? 'Weekdays, 9 AM–6 PM' : 'After hours and weekends'}
          </Button>
          <Button small onClick={() => onChange([])}>
            Saatleri temizle
          </Button>
        </div>
        {value.length ? (
          value.map((entry, index) => (
            <div key={index} className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Select
                  label={`Interval ${index + 1} · day`}
                  value={entry.day}
                  onChange={(event) =>
                    onChange(
                      value.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, day: Number(event.target.value) } : row,
                      ),
                    )
                  }
                >
                  {days.map((day, dayIndex) => (
                    <option key={day} value={dayIndex}>
                      {day}
                    </option>
                  ))}
                </Select>
              </div>
              <div style={{ flex: 1 }}>
                <Input
                  label="Start"
                  value={entry.start}
                  onChange={(event) =>
                    onChange(
                      value.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, start: event.target.value } : row,
                      ),
                    )
                  }
                  pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                  placeholder="18:00"
                  required
                />
              </div>
              <div style={{ flex: 1 }}>
                <Input
                  label="End"
                  value={entry.end}
                  onChange={(event) =>
                    onChange(
                      value.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, end: event.target.value } : row,
                      ),
                    )
                  }
                  pattern="(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)"
                  placeholder="09:00"
                  required
                />
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove interval ${index + 1}`}
                onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        ) : (
          <p className="muted" style={{ fontSize: 12 }}>
            No business hours have been set yet.{' '}
            {calendar
              ? 'Choose business hours for event creation.'
              : 'Automatic customer replies will not start until business hours are set.'}
          </p>
        )}
        <Button
          small
          onClick={() => onChange([...value, { day: 1, start: '09:00', end: '18:00' }])}
        >
          <Plus size={12} />
          Add time interval
        </Button>
        <p className="muted" style={{ fontSize: 12 }}>
          24:00 is the end of the day. If the end time is earlier than the start, the interval
          continues into the next day. The business time zone comes from Business Settings.
        </p>
      </div>
    </fieldset>
  );
}

export function Settings(props: SectionProps) {
  const [revision, setRevision] = useState(0);
  return (
    <SettingsForm
      key={`${props.data.tenant.id}-${revision}`}
      {...props}
      onReset={() => setRevision((current) => current + 1)}
    />
  );
}
function SettingsForm({ data, command, busy, onReset }: SectionProps & { onReset: () => void }) {
  const [baseline] = useState(data.config);
  const editRevision = useRef(0);
  const [hours, setHours] = useState(data.config.activeHours);
  const [calendarHours, setCalendarHours] = useState(data.config.calendarHours);
  const [knowledge, setKnowledge] = useState(data.config.knowledge);
  const [approvals, setApprovals] = useState(data.config.requireApproval);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submittedRevision = editRevision.current;
    const candidate = {
      businessName: field(form, 'businessName'),
      description: field(form, 'description'),
      timezone: field(form, 'timezone'),
      language: field(form, 'language'),
      tone: field(form, 'tone'),
      automationEnabled: form.get('automationEnabled') === 'on',
      activeHours: hours,
      calendarHours,
      knowledge,
      requireApproval: approvals,
      appointmentDuration: Number(field(form, 'appointmentDuration')),
      appointmentBuffer: Number(field(form, 'appointmentBuffer')),
    };
    const patch = Object.fromEntries(
      Object.entries(candidate).filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(baseline[key as keyof BusinessConfig]),
      ),
    );
    const result = await command('config.update', { baseVersion: baseline.version, patch });
    if (result && editRevision.current === submittedRevision) onReset();
  }
  return (
    <form
      onSubmit={submit}
      onChange={() => editRevision.current++}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('button[type="button"]')) editRevision.current++;
      }}
      className="stack"
    >
      {baseline.version !== data.config.version && (
        <Notice variant="orange">
          Settings were changed elsewhere. Your edits are preserved in this form. Load the latest
          settings before saving; this will reset your draft.
          <Button small disabled={!!busy} onClick={onReset}>
            Load latest settings
          </Button>
        </Notice>
      )}
      <div className="grid-two">
        <Panel
          title="Business details"
          description={`Saved configuration · v${data.config.version}`}
        >
          <div className="panel-body form-stack">
            <Input
              label="Business name"
              name="businessName"
              defaultValue={baseline.businessName}
              required
              maxLength={120}
            />
            <TextArea
              label="Your business and its processes"
              name="description"
              defaultValue={baseline.description}
              rows={4}
              maxLength={8000}
            />
            <div className="fields">
              <Input
                label="Customer communication language"
                name="language"
                defaultValue={baseline.language}
                required
              />
              <Input label="Time zone" name="timezone" defaultValue={baseline.timezone} required />
            </div>
            <Input label="Conversation tone" name="tone" defaultValue={baseline.tone} required />
            <fieldset>
              <legend>Business information sources</legend>
              <div className="form-stack">
                {knowledge.map((item, index) => (
                  <div className="form-stack" key={index}>
                    <div className="row" style={{ alignItems: 'flex-end' }}>
                      <div className="spacer">
                        <Input
                          label={`Information ${index + 1} title`}
                          value={item.title}
                          onChange={(event) =>
                            setKnowledge((previous) =>
                              previous.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, title: event.target.value } : row,
                              ),
                            )
                          }
                          required
                        />
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${item.title || 'information'} record`}
                        onClick={() =>
                          setKnowledge((previous) =>
                            previous.filter((_, rowIndex) => rowIndex !== index),
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <TextArea
                      label="Current information and policy"
                      value={item.content}
                      onChange={(event) =>
                        setKnowledge((previous) =>
                          previous.map((row, rowIndex) =>
                            rowIndex === index ? { ...row, content: event.target.value } : row,
                          ),
                        )
                      }
                      required
                      rows={3}
                    />
                  </div>
                ))}
                <Button
                  small
                  onClick={() =>
                    setKnowledge((previous) => [...previous, { title: '', content: '' }])
                  }
                >
                  <Plus size={12} />
                  Add information / policy
                </Button>
              </div>
            </fieldset>
          </div>
        </Panel>
        <Panel
          title="Communication and approvals"
          description="When and under which rules the customer agent can operate"
        >
          <div className="panel-body form-stack">
            <Checkbox
              label="Enable automatic customer communication"
              name="automationEnabled"
              defaultChecked={baseline.automationEnabled}
            />
            <Notice>
              Customer communication only starts during active hours and through ready connections.
              Staff can always use the panel; scheduled jobs follow a separate schedule.
            </Notice>
            <HoursEditor value={hours} onChange={setHours} />
            <fieldset>
              <legend>Actions requiring human approval</legend>
              <div className="form-stack">
                {[
                  ['email.send', 'Send email'],
                  ['calendar.cancel', 'Cancel calendar event'],
                  ['calendar.create', 'Create calendar event'],
                  ['browser.execute', 'Perform browser actions'],
                ].map(([key, label]) => (
                  <Checkbox
                    key={key}
                    label={label ?? ''}
                    checked={approvals.includes(key ?? '')}
                    onChange={(event) =>
                      setApprovals((previous) =>
                        event.target.checked
                          ? [...new Set([...previous, key ?? ''])]
                          : previous.filter((item) => item !== key),
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
            <p className="muted" style={{ fontSize: 12 }}>
              Risky changes to access and approval rules require admin approval against the latest
              version.
            </p>
          </div>
        </Panel>
      </div>
      <Panel
        title="Calendar rules"
        description="Appointment rules independent of customer communication hours"
      >
        <div className="panel-body grid-two">
          <div className="form-stack">
            <Input
              label="Appointment duration (minutes)"
              name="appointmentDuration"
              type="number"
              min={5}
              max={480}
              defaultValue={baseline.appointmentDuration}
              required
            />
            <Input
              label="Buffer between appointments (minutes)"
              name="appointmentBuffer"
              type="number"
              min={0}
              max={240}
              defaultValue={baseline.appointmentBuffer}
              required
            />
            <Notice>
              Availability comes from the provider. If another system also manages the calendar,
              specify the authoritative system in the connection purpose.
            </Notice>
          </div>
          <HoursEditor calendar value={calendarHours} onChange={setCalendarHours} />
        </div>
      </Panel>
      <div className="row between wrap">
        <span className="muted" style={{ fontSize: 12 }}>
          Changes from chat and the panel use the same settings version.
        </span>
        <Button type="submit" variant="primary" disabled={!!busy} busy={busy === 'config.update'}>
          <Save size={14} />
          Save business settings
        </Button>
      </div>
    </form>
  );
}
