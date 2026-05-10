import { describe, expect, it } from 'vitest';

import { orderTasksForImplementation, type ImplementationOrderTask } from './taskOrdering';

const baseTask = (task: Partial<ImplementationOrderTask> & Pick<ImplementationOrderTask, 'id'>): ImplementationOrderTask => ({
  title: task.id,
  priority: 'medium',
  prerequisiteTaskIds: [],
  updatedAt: '2026-05-10T09:00:00.000Z',
  ...task,
});

describe('orderTasksForImplementation', () => {
  it('orders higher priority independent tasks first', () => {
    const ordered = orderTasksForImplementation([
      baseTask({ id: 'low', priority: 'low' }),
      baseTask({ id: 'urgent', priority: 'urgent' }),
      baseTask({ id: 'high', priority: 'high' }),
    ]);

    expect(ordered.map((task) => task.id)).toEqual(['urgent', 'high', 'low']);
  });

  it('keeps prerequisites before higher priority dependents', () => {
    const ordered = orderTasksForImplementation([
      baseTask({ id: 'dependent', priority: 'urgent', prerequisiteTaskIds: ['prerequisite'] }),
      baseTask({ id: 'independent', priority: 'high' }),
      baseTask({ id: 'prerequisite', priority: 'low' }),
    ]);

    expect(ordered.map((task) => task.id)).toEqual(['independent', 'prerequisite', 'dependent']);
  });

  it('uses a stable fallback for missing prerequisites', () => {
    const ordered = orderTasksForImplementation([
      baseTask({ id: 'later', priority: 'medium', updatedAt: '2026-05-10T10:00:00.000Z', prerequisiteTaskIds: ['external'] }),
      baseTask({ id: 'earlier', priority: 'medium', updatedAt: '2026-05-10T09:00:00.000Z' }),
    ]);

    expect(ordered.map((task) => task.id)).toEqual(['earlier', 'later']);
  });
});
