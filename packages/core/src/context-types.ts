export type ContextKind = 'text' | 'link' | 'image' | 'pdf' | 'pptx' | 'docx';
export type ContextStatus = 'awaiting_provider' | 'analyzing' | 'ready' | 'needs_attention';
export interface ContextAttachment {
  id: string;
  title: string;
  kind: ContextKind;
  status: ContextStatus;
  summary: string | null;
  error: string | null;
  createdAt: string;
  url?: string;
}
export interface ContextQuestion {
  id: string;
  prompt: string;
  reason: string;
  sourceIds: string[];
  status: 'open' | 'answered';
  answer?: string;
  createdAt: string;
}
export interface ContextMaterials {
  attachments: ContextAttachment[];
  questions: ContextQuestion[];
  version: number;
  analyzedVersion: number | null;
  status: 'empty' | ContextStatus;
  error: string | null;
}
export type ContextMaterialsView = ContextMaterials;
export type AIProviderKind = 'opencode_go' | 'openai';
export interface AIProviderView {
  id: string;
  name: string;
  provider: AIProviderKind;
  model: string;
  enabled: boolean;
  status: string;
  hasCredentials: boolean;
  lastError: string | null;
  lastTestAt: string | null;
}
