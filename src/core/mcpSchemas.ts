import { z } from 'zod';

import {
  actorSchema,
  artifactKindSchema,
  createTaskBaseSchema,
  idSchema,
  nonEmptyTrimmedString,
  projectContextInputSchema,
  projectLifecycleStatusSchema,
  replacementTaskSchema,
  taskPrioritySchema,
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
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  labels: z.array(z.string()),
  needsGrooming: z.boolean(),
  dependencyStatus: z.enum(['unblocked', 'blocked_by_tasks', 'blocked_external']),
  prerequisiteTaskIds: z.array(idSchema),
  dependentTaskIds: z.array(idSchema),
  blockingPrerequisites: z.array(z.object({ id: idSchema, title: z.string(), status: taskStatusSchema })),
  activeClaim: z
    .object({
      claimId: idSchema,
      taskId: idSchema,
      agentId: idSchema,
      claimedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
      lastHeartbeatAt: z.string().datetime(),
      releasedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  isClaimable: z.boolean(),
  updatedAt: z.string().datetime(),
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
    output: z.object({
      projects: z.array(
        z.object({
          id: idSchema,
          name: z.string(),
          description: z.string(),
          repoPath: z.string(),
          projectDbPath: z.string(),
          lifecycleStatus: projectLifecycleStatusSchema,
          updatedAt: z.string().datetime(),
        }),
      ),
    }),
  },
  create_project: {
    input: z.object({
      actor: actorSchema,
      name: nonEmptyTrimmedString.max(120),
      repoPath: nonEmptyTrimmedString,
      description: z.string().trim().default(''),
    }),
    output: z.object({ projectId: idSchema }),
  },
  register_project: {
    input: z.object({ actor: actorSchema, repoPath: nonEmptyTrimmedString }),
    output: z.object({ projectId: idSchema, registered: z.literal(true) }),
  },
  unregister_project: {
    input: z.object({ actor: actorSchema, projectId: idSchema }),
    output: z.object({ projectId: idSchema, unregistered: z.literal(true) }),
  },
  get_project_context: {
    input: z.object({ projectId: idSchema }),
    output: projectContextInputSchema.extend({ projectId: idSchema, updatedAt: z.string().datetime() }),
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
  mark_task_groomed: {
    input: z.object({ actor: actorSchema, taskId: idSchema }),
    output: taskResponseSchema,
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
    output: z.object({
      claimId: idSchema,
      taskId: idSchema,
      agentId: idSchema,
      claimedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
      lastHeartbeatAt: z.string().datetime(),
      releasedAt: z.string().datetime().nullable(),
    }),
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
