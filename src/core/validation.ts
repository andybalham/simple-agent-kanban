import { z } from 'zod';

import { artifactKinds, taskPriorities, taskStatuses } from './domain.ts';

/**
 * DomainValidationError is the friendly error shape services throw when a
 * workflow rule is violated. MCP and HTTP layers can catch this error later and
 * return predictable agent-readable failures without exposing stack traces.
 */
export class DomainValidationError extends Error {
  readonly code: string;
  readonly details: string[];

  constructor(code: string, message: string, details: string[] = []) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Small assertion helper for workflow invariants. Using one helper keeps rule
 * failures consistent and makes the business rule read close to where it is
 * enforced.
 */
export function invariant(condition: boolean, code: string, message: string, details: string[] = []): asserts condition {
  if (!condition) {
    throw new DomainValidationError(code, message, details);
  }
}

/**
 * Shared schemas live beside domain validation so MCP, HTTP, and in-memory
 * service tests can reuse the same boundary rules. This prevents "valid through
 * MCP but invalid through HTTP" drift as the project grows.
 */
export const actorSchema = z.object({
  type: z.enum(['agent', 'human', 'system']),
  id: z.string().trim().min(1),
});

export const taskStatusSchema = z.enum(taskStatuses);
export const taskPrioritySchema = z.enum(taskPriorities);
export const artifactKindSchema = z.enum(artifactKinds);
export const projectLifecycleStatusSchema = z.enum(['active', 'completed']);

/**
 * Common primitives keep validation intent visible. IDs are currently simple
 * non-empty strings because Phase 1 is storage-agnostic; Phase 2 can decide the
 * concrete ID generator without changing callers.
 */
export const nonEmptyTrimmedString = z.string().trim().min(1);
export const labelSchema = z.string().trim().min(1).max(40);
export const idSchema = z.string().trim().min(1);

/**
 * Project context fields default to empty strings/nulls so agents always receive
 * a complete object. That is easier for tool callers than handling many missing
 * optional fields.
 */
export const projectContextInputSchema = z.object({
  overviewMarkdown: z.string().default(''),
  agentInstructionsMarkdown: z.string().default(''),
  repoPath: z.string().trim().min(1).nullable().default(null),
  defaultBranch: z.string().trim().min(1).nullable().default(null),
  packageManager: z.string().trim().min(1).nullable().default(null),
  installCommand: z.string().trim().min(1).nullable().default(null),
  testCommand: z.string().trim().min(1).nullable().default(null),
  buildCommand: z.string().trim().min(1).nullable().default(null),
  lintCommand: z.string().trim().min(1).nullable().default(null),
  codingConventionsMarkdown: z.string().default(''),
});

/**
 * createTaskBaseSchema is intentionally close to the domain Task shape but only
 * includes caller-provided fields. Service code fills derived fields such as ID,
 * timestamps, createdBy, sourceTaskId, and completion/archive timestamps.
 */
export const createTaskBaseSchema = z.object({
  projectId: idSchema,
  title: nonEmptyTrimmedString.max(160),
  description: z.string().trim().default(''),
  acceptanceCriteria: z.array(nonEmptyTrimmedString).default([]),
  status: taskStatusSchema.default('backlog'),
  priority: taskPrioritySchema.default('medium'),
  labels: z.array(labelSchema).default([]),
  prerequisiteTaskIds: z.array(idSchema).default([]),
  needsGrooming: z.boolean().optional(),
});

export const updateTaskBaseSchema = createTaskBaseSchema
  .omit({
    projectId: true,
    status: true,
    prerequisiteTaskIds: true,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one task field must be provided.',
  });

/**
 * Replacement tasks are created by split_task. They inherit the original project
 * and source metadata from the split workflow, so callers provide only the new
 * task details plus any replacement-specific prerequisites.
 */
export const replacementTaskSchema = createTaskBaseSchema
  .omit({
    projectId: true,
    prerequisiteTaskIds: true,
    needsGrooming: true,
  })
  .partial({
    status: true,
    priority: true,
    labels: true,
    acceptanceCriteria: true,
    description: true,
  })
  .extend({
    title: nonEmptyTrimmedString.max(160),
    description: z.string().trim().default(''),
    acceptanceCriteria: z.array(nonEmptyTrimmedString).default([]),
    status: taskStatusSchema.default('backlog'),
    priority: taskPrioritySchema.default('medium'),
    labels: z.array(labelSchema).default([]),
    prerequisiteTaskIds: z.array(idSchema).optional(),
  });

/**
 * Completion and explicit verification both need at least one evidence item.
 * A free-form summary alone is not enough to prove the work was checked.
 */
export const verificationEvidenceSchema = z.array(nonEmptyTrimmedString).min(1);
