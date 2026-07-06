import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from 'open-brain-workers-shared';

vi.mock('open-brain-workers-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('open-brain-workers-shared')>();
  return { ...actual, deleteMemory: vi.fn() };
});

import { handleDeleteMemory } from './delete-memory.js';
import { deleteMemory } from 'open-brain-workers-shared';

const mockDeleteMemory = vi.mocked(deleteMemory);
const FAKE_SQL = {} as Db;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleDeleteMemory', () => {
  it('deletes by id and returns the deletion confirmation', async () => {
    mockDeleteMemory.mockResolvedValue({ id: 'mem-1' });

    const result = await handleDeleteMemory(FAKE_SQL, { id: 'mem-1' });

    expect(mockDeleteMemory).toHaveBeenCalledWith(FAKE_SQL, 'mem-1');
    expect(result).toEqual({ id: 'mem-1', deleted: true });
  });

  it('propagates the explicit not-found error', async () => {
    mockDeleteMemory.mockRejectedValue(new Error('Memory not found: missing-id'));

    await expect(handleDeleteMemory(FAKE_SQL, { id: 'missing-id' })).rejects.toThrow(
      'Memory not found: missing-id',
    );
  });
});
