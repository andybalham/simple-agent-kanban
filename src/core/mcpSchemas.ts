import { z } from 'zod';

import {
  actorSchema,
  artifactKindSchema,
  createTaskBaseSchema,
  idSchema,
  nonEmptyTrimmedString,
  projectContextInputSchema,
  replacementTaskSchema,
  taskStatusSchema,
  verificationEvidenceSchema,
} from './validation.ts';

/**
 * MCP schemas are the agent-facing contract. They are defined in core rather
 * than in the MCP process so HTTP, tests, docs, and future adapters can reason
 * from the same workflow boundary.
 */

const optionalProjectFilterSchema = z.object({
  projectId: idSchema.optional(),
});

/**
 * Tool outputs should contain follow-up IDs and current workflow facts, not UI
 * card shapes. The UI can build richer presentation models through HTTP later.
 */
const taskResponseSchema = z.object({
  taskId: idSchema,
  projectId: idSchema,
  status: taskStatusSchema,
  needsGrooming: z.boolean(),
});

/**
 * V1 tool registry. Each entry documents the input and output schema for one
 * intentional workflow operation. These are not raw CRUD database operations:
 * service implementations must still enforce dependency, claim, event, and
 * completion rules behind the schemas.
 */
export const mcpToolSchemas = {
  list_projects: {
    input: z.object({}),
    output: z.object({ projects: z.array(z.object({ id: idSchema, name: z.string() })) }),
  },
  create_project: {
    input: z.object({
      actor: actorSchema,
      name: nonEmptyTrimmedString.max(120),
      description: z.string().trim().default(''),
    }),
    output: z.object({ projectId: idSchema }),
  },
  get_project_context: {
    input: z.object({ projectId: idSchema }),
    output: projectContextInputSchema.extend({ projectId: idSchema }),
  },
  update_project_context: {
    input: z.object({ actor: actorSchema, projectId: idSchema, context: projectContextInputSchema.partial() }),
    output: z.object({ projectId: idSchema, updated: z.literal(true) }),
  },
  list_tasks: {
    input: optionalProjectFilterSchema.extend({
      status: taskStatusSchema.optional(),
      claimableOnly: z.boolean().default(false),
    }),
    output: z.object({ tasks: z.array(taskResponseSchema) }),
  },
  create_task: {
    input: createTaskBaseSchema.extend({ actor: actorSchema }),
    output: taskResponseSchema,
  },
  update_task_dependencies: {
    input: z.object({
      actor: actorSchema,
      taskId: idSchema,
      prerequisiteTaskIds: z.array(idSchema),
    }),
    output: z.object({ taskId: idSchema, prerequisiteTaskIds: z.array(idSchema) }),
  },
  split_task: {
    input: z.object({
      actor: actorSchema,
      taskId: idSchema,
      reason: nonEmptyTrimmedString,
      replacements: z.array(replacementTaskSchema).min(2),
      dependencyHandling: z
        .object({
          // True means replacement tasks keep the original task's prerequisites.
          moveOriginalPrerequisitesToReplacements: z.boolean().default(true),
          // Optional explicit rewiring target for tasks that depended on the original.
          moveOriginalDependentsToReplacementIds: z.array(idSchema).optional(),
        })
        .optional(),
    }),
    output: z.object({ archivedTaskId: idSchema, replacementTaskIds: z.array(idSchema).min(2) }),
  },
  claim_task: {
    input: z.object({ agentId: idSchema, taskId: idSchema, leaseSeconds: z.number().int().positive().default(1800) }),
    output: z.object({ claimId: idSchema, taskId: idSchema, expiresAt: z.string().datetime() }),
  },
  heartbeat_claim: {
    input: z.object({ agentId: idSchema, claimId: idSchema, leaseSeconds: z.number().int().positive().default(1800) }),
    output: z.object({ claimId: idSchema, expiresAt: z.string().datetime() }),
  },
  release_claim: {
    input: z.object({ actor: actorSchema, claimId: idSchema }),
    output: z.object({ claimId: idSchema, released: z.literal(true) }),
  },
  update_task_status: {
    input: z.object({ actor: actorSchema, taskId: idSchema, status: taskStatusSchema }),
    output: taskResponseSchema,
  },
  add_task_note: {
    input: z.object({ actor: actorSchema, taskId: idSchema, note: nonEmptyTrimmedString }),
    output: z.object({ eventId: idSchema }),
  },
  record_artifact: {
    input: z.object({
      actor: actorSchema,
      taskId: idSchema,
      kind: artifactKindSchema,
      value: nonEmptyTrimmedString,
      metadata: z.record(z.unknown()).default({}),
    }),
    output: z.object({ artifactId: idSchema }),
  },
  record_verification: {
    input: z.object({
      actor: actorSchema,
      taskId: idSchema,
      summary: nonEmptyTrimmedString,
      evidence: verificationEvidenceSchema,
    }),
    output: z.object({ verificationId: idSchema }),
  },
  request_review: {
    input: z.object({ actor: actorSchema, taskId: idSchema, summary: nonEmptyTrimmedString }),
    output: taskResponseSchema,
  },
  complete_task: {
    input: z.object({
      actor: actorSchema,
      taskId: idSchema,
      summary: nonEmptyTrimmedString,
      evidence: verificationEvidenceSchema.optional(),
    }),
    output: taskResponseSchema.extend({ completedAt: z.string().datetime() }),
  },
} as const;

/**
 * McpToolName lets later MCP registration code iterate over known tools without
 * losing type safety or accepting arbitrary tool names.
 */
export type McpToolName = keyof typeof mcpToolSchemas;
