type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type ImplementationOrderTask = {
  id: string;
  title: string;
  priority: TaskPriority;
  prerequisiteTaskIds: string[];
  updatedAt: string;
};

const priorityRank: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function orderTasksForImplementation<T extends ImplementationOrderTask>(tasks: T[]): T[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const remaining = new Set(tasks.map((task) => task.id));
  const dependentIdsByPrerequisiteId = new Map<string, string[]>();
  const unresolvedPrerequisiteCount = new Map<string, number>();

  for (const task of tasks) {
    const prerequisiteIds = task.prerequisiteTaskIds.filter((prerequisiteId) => taskById.has(prerequisiteId));
    unresolvedPrerequisiteCount.set(task.id, prerequisiteIds.length);

    for (const prerequisiteId of prerequisiteIds) {
      dependentIdsByPrerequisiteId.set(prerequisiteId, [...(dependentIdsByPrerequisiteId.get(prerequisiteId) ?? []), task.id]);
    }
  }

  const ordered: T[] = [];
  while (remaining.size > 0) {
    const readyTasks = [...remaining]
      .filter((taskId) => (unresolvedPrerequisiteCount.get(taskId) ?? 0) === 0)
      .map((taskId) => taskById.get(taskId))
      .filter(isTask);

    const nextTask = (readyTasks.length > 0 ? readyTasks : [...remaining].map((taskId) => taskById.get(taskId)).filter(isTask)).sort(
      compareImplementationCandidates,
    )[0];

    remaining.delete(nextTask.id);
    ordered.push(nextTask);

    for (const dependentId of dependentIdsByPrerequisiteId.get(nextTask.id) ?? []) {
      unresolvedPrerequisiteCount.set(dependentId, Math.max(0, (unresolvedPrerequisiteCount.get(dependentId) ?? 0) - 1));
    }
  }

  return ordered;
}

function compareImplementationCandidates(left: ImplementationOrderTask, right: ImplementationOrderTask) {
  const priorityComparison = priorityRank[left.priority] - priorityRank[right.priority];
  if (priorityComparison !== 0) {
    return priorityComparison;
  }

  const updatedComparison = new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
  if (updatedComparison !== 0) {
    return updatedComparison;
  }

  const titleComparison = left.title.localeCompare(right.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.id.localeCompare(right.id);
}

function isTask<T extends ImplementationOrderTask>(task: T | undefined): task is T {
  return task !== undefined;
}
