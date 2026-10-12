export { ProviderError, ExternalOutcomeUnknown, refreshOAuthCredentials } from './http.js';
export { testEmailConnection, sendEmail, readEmailMessages } from './email.js';
export type { EmailKind, EmailInput, IncomingEmail, VerifiedResult } from './email.js';
export {
  testCalendarConnection,
  getCalendarAvailability,
  createCalendarEvent,
  calculateCalendarSlots,
  withinCalendarHours,
} from './calendar.js';
export type { CalendarKind, CalendarRules, CalendarEventInput, TimeRange } from './calendar.js';
export { inspectMcpConnection, executeMcpTool } from './mcp.js';
export type { McpToolView, McpExecutionInput } from './mcp.js';
export { planCustomerReply, proposeConfiguration } from './models.js';
export type {
  CustomerPlanInput,
  CustomerReplyPlan,
  ConfigurationProposalInput,
  ConfigurationProposal,
} from './models.js';
export { createPaymentLink, verifyPaymentWebhook } from './payments.js';
export type { PaymentLinkInput, PaymentWebhook } from './payments.js';

export {
  prepareCalendarEvent,
  updateCalendarEvent,
  cancelCalendarEvent,
} from './calendar-operations.js';
export type {
  CalendarEventSnapshot,
  CalendarEventUpdateInput,
  CalendarEventCancelInput,
} from './calendar-operations.js';
