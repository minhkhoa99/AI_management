import { z } from 'zod';
import { accessLevelSchema, agentProviderSchema, apiFormatSchema } from './enumerations';
import { entityIdSchema } from './organization';

// Contracts for engines ("brains"): local CLI engines, Custom API connections, test runs and
// the event stream every engine produces (phase 2).

/** Engines running on this machine with the user's signed-in account. */
export const LOCAL_ENGINES = ['claude_code', 'codex'] as const;
export const localEngineSchema = z.enum(LOCAL_ENGINES);
export type LocalEngine = z.infer<typeof localEngineSchema>;

/**
 * Model ids end up as CLI arguments and URL/body fields: letters, digits and . _ : / - only, and
 * never starting with "-" (would be read as a CLI flag).
 */
export const modelNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/, 'Tên model không hợp lệ');

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * API base URL. https is required except for loopback hosts (local Ollama, vLLM…), so an API
 * key is never sent in clear text over the network. Credentials, query and fragment are refused.
 */
export const apiBaseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((rawUrl) => {
    if (!URL.canParse(rawUrl)) {
      return false;
    }
    const url = new URL(rawUrl);
    const isLoopback = LOOPBACK_HOSTNAMES.has(url.hostname);
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback)) &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  }, 'URL phải dùng https (http chỉ cho localhost), không chứa tài khoản, query hay #');

// ---- Local engines -------------------------------------------------------------------------

export const localEngineSettingsSchema = z.object({
  defaultModel: modelNameSchema.nullable(),
  /** Deny destructive shell commands (rm -rf, git push, deploy…) in automated runs. */
  blockDangerousCommands: z.boolean(),
  /** Ceiling: when false, no agent on this engine gets network access, whatever its own flag. */
  allowNetwork: z.boolean(),
});
export type LocalEngineSettings = z.infer<typeof localEngineSettingsSchema>;

export const updateLocalEngineSettingsRequestSchema = localEngineSettingsSchema
  .partial()
  .strict()
  .refine((request) => Object.keys(request).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
export type UpdateLocalEngineSettingsRequest = z.infer<
  typeof updateLocalEngineSettingsRequestSchema
>;

export const localEngineStatusSchema = z.object({
  engine: localEngineSchema,
  installed: z.boolean(),
  version: z.string().nullable(),
  /** null when it could not be determined (e.g. the CLI is missing). */
  signedIn: z.boolean().nullable(),
  accountDetail: z.string().nullable(),
  problem: z.string().nullable(),
  settings: localEngineSettingsSchema,
  agentNames: z.array(z.string()),
});
export type LocalEngineStatus = z.infer<typeof localEngineStatusSchema>;
export const localEngineStatusListSchema = z.array(localEngineStatusSchema);

// ---- Engine event stream -------------------------------------------------------------------

/** Normalised events every engine emits, whatever its native output format. */
export const agentEngineEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session_started'),
    sessionRef: z.string().nullable(),
    model: z.string().nullable(),
  }),
  z.object({ kind: z.literal('text_delta'), text: z.string() }),
  z.object({ kind: z.literal('message'), text: z.string() }),
  z.object({ kind: z.literal('tool_call'), toolName: z.string(), detail: z.string() }),
  z.object({
    kind: z.literal('command'),
    command: z.string(),
    exitCode: z.number().int().nullable(),
    output: z.string(),
  }),
  z.object({
    kind: z.literal('file_change'),
    path: z.string(),
    changeKind: z.enum(['add', 'update', 'delete']),
  }),
  z.object({
    kind: z.literal('usage'),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    /** Only known for Claude Code and Custom API; null otherwise. */
    costUsd: z.number().nonnegative().nullable(),
  }),
  z.object({ kind: z.literal('completed'), summary: z.string().nullable() }),
  z.object({
    kind: z.literal('failed'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({ kind: z.literal('cancelled') }),
]);
export type AgentEngineEvent = z.infer<typeof agentEngineEventSchema>;

/** One server-sent event of a test run: increasing sequence number + engine event. */
export const engineTestRunMessageSchema = z.object({
  sequence: z.number().int().nonnegative(),
  event: agentEngineEventSchema,
});
export type EngineTestRunMessage = z.infer<typeof engineTestRunMessageSchema>;

export const engineTestRunStartedSchema = z.object({ testRunId: entityIdSchema });

// ---- Custom API connections ----------------------------------------------------------------

const connectionNameSchema = z.string().trim().min(1, 'Nhập tên kết nối').max(60);

export const providerConnectionSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  format: apiFormatSchema,
  baseUrl: z.string(),
  /** Last 4 characters of the API key, or null without a key. The key itself never leaves the server. */
  keyHint: z.string().nullable(),
  models: z.array(z.string()),
  defaultModel: z.string().nullable(),
  agentNames: z.array(z.string()),
});
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export const providerConnectionListSchema = z.array(providerConnectionSchema);

/** Create and update share one shape; on update an omitted apiKey keeps the stored key. */
export const saveProviderConnectionRequestSchema = z
  .object({
    name: connectionNameSchema,
    format: apiFormatSchema,
    baseUrl: apiBaseUrlSchema,
    apiKey: z.string().trim().min(1).max(500).optional(),
    models: z.array(modelNameSchema).max(200),
    defaultModel: modelNameSchema.nullable(),
  })
  .strict()
  .refine(
    (request) => request.defaultModel === null || request.models.includes(request.defaultModel),
    { message: 'Model mặc định phải nằm trong danh sách model', path: ['defaultModel'] },
  );
export type SaveProviderConnectionRequest = z.infer<typeof saveProviderConnectionRequestSchema>;

/** Model discovery before saving (key typed in the form) or for a saved connection. */
export const modelDiscoveryRequestSchema = z
  .object({
    format: apiFormatSchema,
    baseUrl: apiBaseUrlSchema,
    apiKey: z.string().trim().min(1).max(500).optional(),
    connectionId: entityIdSchema.optional(),
  })
  .strict();
export type ModelDiscoveryRequest = z.infer<typeof modelDiscoveryRequestSchema>;

export const modelDiscoveryResultSchema = z.object({ models: z.array(z.string()) });

export const connectionCheckResultSchema = z.object({
  reachable: z.boolean(),
  modelCount: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative(),
  message: z.string(),
});
export type ConnectionCheckResult = z.infer<typeof connectionCheckResultSchema>;

export const startConnectionTestRunRequestSchema = z.object({ model: modelNameSchema }).strict();

// ---- Agent configuration -------------------------------------------------------------------

/** Brain and permissions of one agent. Publishes AgentConfigurationChanged when it changes. */
export const changeAgentConfigurationRequestSchema = z
  .object({
    provider: agentProviderSchema.optional(),
    connectionId: entityIdSchema.nullable().optional(),
    model: modelNameSchema.nullable().optional(),
    accessLevel: accessLevelSchema.optional(),
    networkAccess: z.boolean().optional(),
  })
  .strict()
  .refine((request) => Object.keys(request).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  });
export type ChangeAgentConfigurationRequest = z.infer<typeof changeAgentConfigurationRequestSchema>;
