import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JsonObject } from '../types.js';
import { ExternalOutcomeUnknown, object, ProviderError, textField } from './http.js';
import type { VerifiedResult } from './email.js';
import { mcpOAuthAccessToken } from '../mcp-oauth.js';

export interface McpToolView {
  name: string;
  description: string;
  inputSchema: JsonObject;
  annotations: JsonObject;
}
export interface McpExecutionInput {
  tool: string;
  arguments: JsonObject;
  allowedTools: string[];
  reference: string;
}

export function validateMcpServerUrl(config: JsonObject): URL {
  let url: URL;
  try {
    url = new URL(textField(config, 'url'));
  } catch {
    throw new ProviderError('MCP sunucu adresi geçerli değil.', 422);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new ProviderError('MCP bağlantısı HTTPS veya yerel bir HTTP adresi olmalı.', 422);
  if (/^(169\.254\.|0\.0\.0\.0$)/.test(url.hostname) || url.hostname === 'metadata.google.internal')
    throw new ProviderError('Bu MCP sunucu adresine erişim verilemez.', 422);
  return url;
}

async function withClient<T>(
  config: JsonObject,
  secrets: JsonObject,
  action: (client: Client, accessToken: string | undefined) => Promise<T>,
): Promise<T> {
  const url = validateMcpServerUrl(config);
  const headers: Record<string, string> = {};
  if (config.authMode === 'oauth')
    headers.Authorization = `Bearer ${await mcpOAuthAccessToken(config, secrets)}`;
  else if (typeof secrets.accessToken === 'string')
    headers.Authorization = `Bearer ${secrets.accessToken}`;
  const client = new Client({ name: 'afterhours', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers, redirect: 'error' },
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
    fetch: async (input, init) => {
      const target = new URL(String(input));
      if (target.origin !== url.origin)
        throw new ProviderError('MCP sunucusu bağlantı adresinin dışına yönlendiremez.', 422);
      return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    },
  });
  try {
    await client.connect(transport);
    return await action(client, headers.Authorization?.slice(7));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      'MCP sunucusuyla iletişim kurulamadı. Bağlantı ve izinler kontrol edilmeli.',
      502,
      'mcp_unavailable',
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Tool descriptions and schemas are discovery data; they do not grant permissions. */
export async function inspectMcpConnection(
  config: JsonObject,
  secrets: JsonObject,
): Promise<{ verified: boolean; tools: McpToolView[] }> {
  return withClient(config, secrets, async (client, accessToken) => {
    const response = await client.listTools({}, { timeout: 15_000 });
    if (response.nextCursor)
      throw new ProviderError(
        'MCP araç listesi çok büyük. Daha dar kapsamlı bir sunucu bağlayın.',
        422,
      );
    if (response.tools.length > 200)
      throw new ProviderError('MCP bağlantısı en fazla 200 araç sağlayabilir.', 422);
    return {
      verified: true,
      tools: response.tools
        .filter((tool) => !accessToken || !tool.name.includes(accessToken))
        .map((tool) => ({
          name: tool.name,
          description: (tool.description ?? '').slice(0, 2000),
          inputSchema: tool.inputSchema as JsonObject,
          annotations: {
            ...(tool.annotations ?? {}),
            authorizationSource: 'admin_configuration_required',
            untrusted: true,
          },
        })),
    };
  });
}

function atPath(data: JsonObject, path: string): unknown {
  if (
    !/^[A-Za-z0-9_.-]{1,200}$/.test(path) ||
    path.split('.').some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
  )
    throw new ProviderError('MCP doğrulama alanı geçerli değil.', 422);
  let value: unknown = data;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as JsonObject)[key];
  }
  return value;
}

function safeResult(data: JsonObject): JsonObject {
  const redact = (value: unknown, depth: number): unknown => {
    if (depth > 6) return '[truncated]';
    if (typeof value === 'string') return value.slice(0, 20_000);
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 100)
          .map(([key, item]) => [
            key,
            /password|secret|token|api.?key|authorization|cookie/i.test(key)
              ? '[redacted]'
              : redact(item, depth + 1),
          ]),
      );
    return value;
  };
  return object(redact(data, 0));
}

export async function executeMcpTool(
  config: JsonObject,
  secrets: JsonObject,
  input: McpExecutionInput,
): Promise<VerifiedResult> {
  if (!input.allowedTools.includes(input.tool))
    throw new ProviderError('Bu MCP aracı için işlem yetkisi yok.', 403, 'permission_denied');
  if (
    !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.tool) ||
    !input.reference ||
    input.reference.length > 200
  )
    throw new ProviderError('MCP işlem bilgileri geçerli değil.', 422);
  const readOnlyTools = Array.isArray(config.readOnlyTools)
    ? config.readOnlyTools.filter((value): value is string => typeof value === 'string')
    : [];
  const readOnly = readOnlyTools.includes(input.tool);
  const rules =
    config.verificationRules && typeof config.verificationRules === 'object'
      ? object(config.verificationRules)
      : {};
  if (!readOnly && (!rules[input.tool] || typeof rules[input.tool] !== 'object'))
    throw new ProviderError(
      'MCP yazma aracı için doğrulama ölçütü henüz tanımlanmadı.',
      422,
      'verification_required',
    );
  const rule = !readOnly ? object(rules[input.tool]) : null;
  if (
    rule &&
    (!input.allowedTools.includes(textField(rule, 'tool')) ||
      !readOnlyTools.includes(textField(rule, 'tool')))
  )
    throw new ProviderError(
      'MCP yazma işlemi için izinli salt-okunur doğrulama aracı gerekiyor.',
      422,
      'verification_required',
    );
  if (rule) {
    for (const field of ['idPath', 'proofIdPath']) atPath({}, textField(rule, field));
    textField(rule, 'recordIdArgument');
    const expected = object(rule.expected);
    if (Object.keys(expected).length === 0)
      throw new ProviderError(
        'MCP doğrulama ölçütleri tanımlanmamış.',
        422,
        'verification_required',
      );
    for (const [path, argumentName] of Object.entries(expected)) {
      atPath({}, path);
      if (typeof argumentName !== 'string')
        throw new ProviderError('MCP doğrulama eşleştirmesi geçerli değil.', 422);
    }
  }
  const argumentsValue = { ...input.arguments };
  if (!readOnly) {
    const referenceArgument = textField(object(config.referenceArguments), input.tool);
    if (
      !/^[A-Za-z0-9_]{1,100}$/.test(referenceArgument) ||
      ['__proto__', 'prototype', 'constructor'].includes(referenceArgument)
    )
      throw new ProviderError('MCP referans alanı geçerli değil.', 422);
    argumentsValue[referenceArgument] = input.reference;
  }
  return withClient(config, secrets, async (client) => {
    let writeStarted = false;
    try {
      writeStarted = !readOnly;
      const result = await client.callTool(
        { name: input.tool, arguments: argumentsValue },
        undefined,
        { timeout: 20_000 },
      );
      if (result.isError) {
        if (!readOnly)
          throw new ExternalOutcomeUnknown(
            'MCP yazma aracı hata döndürdü; dış kayıt kontrol edilmeli.',
          );
        throw new ProviderError('MCP okuma aracı işlemi reddetti.', 502, 'mcp_tool_error');
      }
      if (readOnly) {
        const payload = result.structuredContent
          ? object(result.structuredContent)
          : { content: result.content };
        return {
          verified: true,
          externalRecordId: input.reference,
          evidence: {
            source: 'mcp',
            tool: input.tool,
            readOnly: true,
            untrustedResult: safeResult(payload),
          },
        };
      }
      if (!rule || !result.structuredContent)
        throw new ExternalOutcomeUnknown(
          'MCP yazma sonucu yapılandırılmış doğrulama verisi içermiyor.',
        );
      const written = object(result.structuredContent);
      const recordId = atPath(written, textField(rule, 'idPath'));
      if (typeof recordId !== 'string' || !recordId)
        throw new ExternalOutcomeUnknown('MCP yazma sonucu kayıt kimliği içermiyor.');
      const checkArguments: JsonObject = { [textField(rule, 'recordIdArgument')]: recordId };
      const proof = await client.callTool(
        { name: textField(rule, 'tool'), arguments: checkArguments },
        undefined,
        { timeout: 15_000 },
      );
      if (proof.isError || !proof.structuredContent)
        throw new ExternalOutcomeUnknown('MCP kaydı yeniden okunamadı.');
      const verified = object(proof.structuredContent);
      if (atPath(verified, textField(rule, 'proofIdPath')) !== recordId)
        throw new ExternalOutcomeUnknown('MCP doğrulamasındaki kayıt kimliği eşleşmedi.');
      const expected = object(rule.expected);
      if (Object.keys(expected).length === 0)
        throw new ExternalOutcomeUnknown('MCP doğrulama ölçütleri tanımlanmamış.');
      for (const [resultPath, argumentName] of Object.entries(expected)) {
        if (
          typeof argumentName !== 'string' ||
          argumentsValue[argumentName] === undefined ||
          JSON.stringify(atPath(verified, resultPath)) !==
            JSON.stringify(argumentsValue[argumentName])
        )
          throw new ExternalOutcomeUnknown('MCP doğrulama sonucu beklenen girdilerle eşleşmedi.');
      }
      return {
        verified: true,
        externalRecordId: recordId,
        evidence: {
          source: 'mcp',
          tool: input.tool,
          verificationTool: rule.tool,
          readBackVerified: true,
          untrustedResult: safeResult(verified),
        },
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (writeStarted)
        throw new ExternalOutcomeUnknown(
          'MCP yazma işleminin sonucu belirsiz; yeniden yazma yapılmadı.',
        );
      throw new ProviderError('MCP aracı çalıştırılamadı.');
    }
  });
}
