/**
 * Shared types for the learnhermes runtime.
 *
 * These types are the contract every module agrees on. You will
 * implement the modules across the 12 stages; the types stay stable.
 *
 * If you need to add a field, add it here and run typecheck across
 * the whole project. Resist the urge to inline-define module-private
 * shapes that other modules also need.
 */

// ──────────────────────────────────────────────────────────────────────────
// Daemon (Stage 1)
// ──────────────────────────────────────────────────────────────────────────

export type DaemonState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping";

export interface DaemonStatus {
  state: DaemonState;
  pid: number | null;
  startedAt: number | null;
  workspace: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Store (Stage 2)
// ──────────────────────────────────────────────────────────────────────────

export interface StoreOptions {
  /** Root directory under which collections are persisted. */
  workspace: string;
}

export type CollectionName =
  | "sessions"
  | "messages"
  | "jobs"
  | "memories"
  | "skills"
  | "schedules"
  | "ledger"
  | "approvals"
  | "tasks"
  | "proposals";

export interface StoreRecord {
  id: string;
  [k: string]: unknown;
}

// ──────────────────────────────────────────────────────────────────────────
// Gateway / Channels (Stage 3)
// ──────────────────────────────────────────────────────────────────────────

export type ChannelId =
  | "cli"
  | "telegram"
  | "discord"
  | "email"
  | string; // allow user-defined channels

export interface MessageEnvelope {
  /** Stable id assigned by the channel for idempotent dedup. */
  id: string;
  channel: ChannelId;
  /** The channel's claim of who sent this. NOT a trust anchor. */
  sender: string;
  /** Plain-text body. Binary payloads not modeled in the course. */
  body: string;
  /** Channel-local thread/conversation id, if any. */
  thread?: string;
  /** Timestamp in ms (provided by the channel, may lag wall clock). */
  receivedAt: number;
  /** Free-form metadata. Channels MAY include but runtime MUST NOT trust. */
  meta?: Record<string, unknown>;
}

export interface RuntimeEvent {
  kind: "message" | "cron" | "delegation" | "system";
  envelope?: MessageEnvelope;
  jobId?: string;
  source: ChannelId | "scheduler" | "subagent" | "system";
  receivedAt: number;
}

export interface Channel {
  readonly id: ChannelId;
  /** Start listening; return when ready. */
  start(): Promise<void>;
  /** Stop listening; flush in-flight outbound. */
  stop(): Promise<void>;
  /** Send an outbound message. */
  send(target: { thread?: string; sender?: string }, body: string): Promise<void>;
  /** Subscribe to inbound. The handler receives normalized envelopes. */
  subscribe(handler: (env: MessageEnvelope) => void | Promise<void>): void;
}

// ──────────────────────────────────────────────────────────────────────────
// Queue (Stage 4)
// ──────────────────────────────────────────────────────────────────────────

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "dead_letter";

export interface Job<P = unknown> {
  id: string;
  kind: string;
  payload: P;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  /** Absolute ms; the queue MUST NOT run the job before this. */
  notBefore: number;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastError: string | null;
  /** Application-supplied dedup key; same key = same job. */
  idempotencyKey?: string;
}

export interface BackoffPolicy {
  /** Base delay in ms for the first retry. */
  baseMs: number;
  /** Exponential factor. 2 = double each attempt. */
  factor: number;
  /** Cap on delay. */
  maxMs: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Scheduler (Stage 5)
// ──────────────────────────────────────────────────────────────────────────

export type Schedule =
  | { type: "once"; at: number /* absolute ms */ }
  | { type: "interval"; everyMs: number; startAt?: number }
  | { type: "cron"; expr: string };

export interface ScheduledJob {
  id: string;
  schedule: Schedule;
  jobKind: string;
  jobPayload: unknown;
  /** Computed: the next absolute ms this should fire. */
  nextFireAt: number;
  lastFiredAt: number | null;
  /** If false the scheduler must skip this entry. */
  enabled: boolean;
  /** Optional max fires (interval/cron). null = unlimited. */
  maxFires: number | null;
  firesSoFar: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Skills (Stage 6)
// ──────────────────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  /** Tool ids this skill claims to need. */
  tools?: string[];
  /** Permissions the skill is requesting. */
  permissions?: PermissionRequest[];
  /** Optional platforms restriction. */
  platforms?: ("darwin" | "linux" | "win32")[];
}

export interface Skill {
  /** Slug derived from directory name; lowercased. */
  id: string;
  /** Where this skill came from on disk. */
  root: string;
  frontmatter: SkillFrontmatter;
  /** Body of the SKILL.md after frontmatter. */
  body: string;
  /** Where this skill was loaded from. */
  origin: "bundled" | "workspace" | "user";
}

// ──────────────────────────────────────────────────────────────────────────
// Permissions (Stage 7)
// ──────────────────────────────────────────────────────────────────────────

export type PermissionAction =
  | "fs.read"
  | "fs.write"
  | "shell"
  | "net.fetch"
  | "secrets.read";

export interface PermissionRequest {
  action: PermissionAction;
  /** Optional glob/string the action is constrained to. */
  scope?: string;
}

export type PermissionVerdict = "allow" | "deny" | "prompt";

export interface PolicyRule {
  /** Skill id this rule applies to, or "*" for default. */
  skill: string;
  action: PermissionAction;
  scope?: string;
  verdict: PermissionVerdict;
  /** Higher precedence wins. Deny precedence > Allow precedence at equal. */
  precedence?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Memory (Stage 8)
// ──────────────────────────────────────────────────────────────────────────

export type MemoryScope =
  | { kind: "user" }
  | { kind: "session"; sessionId: string }
  | { kind: "skill"; skillId: string }
  | { kind: "subagent"; subagentId: string };

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  scope: MemoryScope;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryQuery {
  scope?: MemoryScope;
  tags?: string[];
  /** Substring/keyword query. Trivial impl is fine for the course. */
  search?: string;
  limit?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Subagents (Stage 9)
// ──────────────────────────────────────────────────────────────────────────

export interface SubagentRequest {
  goal: string;
  context?: string;
  toolsets?: string[];
  /** Reuse this subagent's id for resumption. */
  id?: string;
  /** How deep in the delegation tree. */
  depth: number;
}

export interface SubagentResult {
  id: string;
  status: "succeeded" | "failed" | "interrupted" | "timeout";
  summary: string;
  /** Final output the parent may use. Should NOT include child history. */
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Learning (Stage 10)
// ──────────────────────────────────────────────────────────────────────────

export interface TaskRecord {
  id: string;
  pattern: string;
  succeeded: boolean;
  completedAt: number;
  /** Tools the agent used to solve this task. */
  toolsUsed: string[];
  /** Summary suitable for being turned into a skill description. */
  summary: string;
}

export interface SkillProposal {
  id: string;
  /** Slug name proposed for the new skill. */
  name: string;
  description: string;
  body: string;
  /** Records that triggered this proposal. */
  evidence: string[]; // TaskRecord ids
  status: "proposed" | "approved" | "rejected" | "rolled_back";
  createdAt: number;
  version: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Ledger (Stage 11)
// ──────────────────────────────────────────────────────────────────────────

export type LedgerStatus = "started" | "in_progress" | "completed" | "failed";

export interface LedgerEntry {
  id: string;
  kind: string;
  status: LedgerStatus;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  logs: LedgerLog[];
  /** Free-form payload for resumption. */
  resumeToken?: unknown;
}

export interface LedgerLog {
  at: number;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Clock / Time (used by everything)
// ──────────────────────────────────────────────────────────────────────────

export interface Clock {
  now(): number;
  /** Returns a token that can be cleared. The cb fires when at <= now(). */
  schedule(at: number, cb: () => void): { cancel: () => void };
  /** Wait until the given ms; resolves the moment now() >= at. */
  sleepUntil(at: number): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────
// AI client (used in Stage 12; mocked in tests)
// ──────────────────────────────────────────────────────────────────────────

export interface AIRequest {
  system?: string;
  messages: { role: "user" | "assistant" | "tool"; content: string }[];
  /** Available tool ids. The mock will branch on these. */
  tools?: string[];
  /** Caller-supplied request id for dedup; tests use this. */
  requestId?: string;
}

export interface AIResponse {
  /** Final assistant text. */
  text: string;
  /** Optional tool calls the client wants to execute. */
  toolCalls?: { tool: string; args: Record<string, unknown> }[];
}

export interface AIClient {
  complete(req: AIRequest): Promise<AIResponse>;
}

// ──────────────────────────────────────────────────────────────────────────
// Logger
// ──────────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
