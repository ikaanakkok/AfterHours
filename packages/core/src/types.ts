import type { WorkflowClarification } from './workflow-clarifications.js';
export type Role = 'admin' | 'staff';
export type ActorType = 'admin' | 'staff' | 'customer' | 'cron' | 'system';
export type Actor = { type: ActorType; id: string };
export type TenantContext = { tenantId: string; actor: Actor; role: Role | null };
export type JsonObject = Record<string, unknown>;
export type ConnectionKind =
  | 'browser'
  | 'whatsapp'
  | 'gmail'
  | 'outlook'
  | 'google_calendar'
  | 'microsoft_calendar'
  | 'mcp'
  | 'stripe'
  | 'voice_whatsapp'
  | 'voice_phone'
  | 'ai_provider'
  | 'sms'
  | 'ivr';
export type SetupState =
  | 'setup'
  | 'missing_info'
  | 'awaiting_test'
  | 'ready'
  | 'needs_attention'
  | 'disabled'
  | 'login_failed';
export type OperationStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'needs_attention';

export interface BusinessConfig {
  version: number;
  businessName: string;
  description: string;
  timezone: string;
  language: string;
  tone: string;
  automationEnabled: boolean;
  activeHours: Array<{ day: number; start: string; end: string }>;
  knowledge: Array<{ title: string; content: string }>;
  requireApproval: string[];
  paymentsEnabled: boolean;
  appointmentDuration: number;
  appointmentBuffer: number;
  calendarHours: Array<{ day: number; start: string; end: string }>;
}

export type WorkflowStep =
  | { action: 'goto'; url: string }
  | { action: 'fill'; selector: string; value: string; secret?: false }
  | { action: 'click'; selector: string }
  | { action: 'select'; selector: string; value: string }
  | { action: 'read'; selector: string; output: string }
  | { action: 'assert'; selector: string; contains?: string };

export interface WorkflowDefinition {
  name: string;
  purpose: string;
  connectionId: string;
  inputs: Array<{ key: string; label: string; required: boolean }>;
  steps: WorkflowStep[];
  verification: { selector: string; recordIdSelector: string; expected?: string };
  idempotency: { lookupUrl: string; recordIdSelector: string; absentSelector?: string };
  requiresApproval: boolean;
}

export interface BrowserExecutionResult {
  verified: boolean;
  externalRecordId?: string;
  evidence?: JsonObject;
  recovered?: boolean;
}
export interface ConnectionView {
  id: string;
  deletedAt?: Date | string | null;
  name: string;
  kind: ConnectionKind;
  purpose: string;
  status: SetupState;
  config: JsonObject;
  permissions: string[];
  agents: ActorType[];
  hasCredentials: boolean;
  lastTestAt: string | null;
  lastError: string | null;
  realAccountVerified: boolean;
}
export interface WorkflowView {
  clarification: WorkflowClarification | null;
  id: string;
  name: string;
  purpose: string;
  status: SetupState;
  version: number;
  definition: WorkflowDefinition;
  trials: number;
  successfulTrials: number;
  publishedVersion: number | null;
  sourceText: string | null;
  mode: 'legacy' | 'text';
  enabled: boolean;
  systemIds: string[];
  schedule: { expression: string; timezone: string } | null;
  planningError: string | null;
  latestTestOperationId?: string | null;
}
export interface CronView {
  id: string;
  name: string;
  expression: string;
  timezone: string;
  workflowId: string;
  inputs: JsonObject;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
}
export interface ConversationView {
  id: string;
  channel: string;
  customerName: string;
  customerAddress: string;
  emailSubject?: string;
  threadId?: string;
  mode: 'ai' | 'human';
  lastMessage: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    body: string;
    status: string;
    createdAt: string;
    emailSubject?: string;
    sourceDate?: string;
    sourceAddress?: string;
  }>;
}
export interface OperationView {
  id: string;
  capability: string;
  status: OperationStatus;
  actor: Actor;
  inputs: JsonObject;
  connectionId?: string | null;
  workflowId?: string | null;
  conversationId?: string | null;
  cronId?: string | null;
  result: JsonObject | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ApprovalView {
  id: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  operationId: string | null;
  payload: JsonObject;
  createdAt: string;
  decidedBy?: string | null;
}
export interface AuditView {
  id: string;
  event: string;
  actor: Actor;
  targetId: string | null;
  details: JsonObject;
  createdAt: string;
}
export interface WorkspaceView {
  tenant: { id: string; name: string };
  user: { id: string; name: string; email: string; role: Role };
  memberships: Array<{ tenantId: string; name: string; role: Role }>;
  config: BusinessConfig;
  context: import('./context-types.js').ContextMaterialsView;
  connections: ConnectionView[];
  workflows: WorkflowView[];
  cronJobs: CronView[];
  conversations: ConversationView[];
  operations: OperationView[];
  approvals: ApprovalView[];
  handoffs: Array<{
    id: string;
    conversationId: string | null;
    reason: string;
    status: string;
    createdAt: string;
    emailSubject?: string;
    sourceDate?: string;
    sourceAddress?: string;
  }>;
  audit: AuditView[];
  drafts: Array<{
    id: string;
    connectionId: string;
    to: string;
    subject: string;
    body: string;
    status: string;
  }>;
  calendarEvents: Array<{
    id: string;
    connectionId: string;
    title: string;
    start: string;
    end: string;
    status: string;
    providerId: string | null;
  }>;
  proposals: Array<{
    id: string;
    summary: string;
    baseVersion: number;
    status: string;
    patch: JsonObject;
    risk: string;
  }>;
  adminMessages: Array<{ id: string; role: string; body: string; createdAt: string }>;
  emailSync?: import('./email-sync.js').EmailSyncView[];
  managementPlans?: import('./management.js').ManagementPlanView[];
  runtime: {
    mode: 'demo' | 'live';
    workerLastSeen: string | null;
    workerOnline: boolean;
    voiceStatus: string;
    paymentsEnabled: boolean;
  };
}
export interface CommandResult {
  message: string;
  data?: JsonObject;
}
export interface InboundMessage {
  connectionId: string;
  externalId: string;
  address: string;
  name: string;
  body: string;
  channel: 'whatsapp' | 'demo' | 'email';
  timestamp?: string;
}

export interface CoreApi {
  receiveMessage(
    tenantId: string,
    event: InboundMessage,
  ): Promise<{ conversationId: string; duplicate: boolean }>;
  executeOperation(tenantId: string, operationId: string): Promise<void>;
  processConversation(tenantId: string, conversationId: string): Promise<void>;
  tickSchedules(): Promise<void>;
  tickOutbox(
    deliver: (
      tenantId: string,
      connectionId: string,
      address: string,
      body: string,
    ) => Promise<string>,
  ): Promise<void>;
  heartbeat(): Promise<void>;
  tenants(): Promise<Array<{ id: string; name: string }>>;
}
