vi.mock('../db/queries.js', () => ({
  deleteMemory: vi.fn(),
}));

import { handleDeleteMemory } from './delete-memory.js';
import { deleteMemory } from '../db/queries.js';

const mockDeleteMemory = vi.mocked(deleteMemory);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleDeleteMemory', () => {
  it('deletes by id and returns the deletion confirmation', async () => {
    mockDeleteMemory.mockResolvedValue({ id: 'a4a0648c-3df9-48a7-85e6-160a56576bc9' });

    const result = await handleDeleteMemory({ id: 'a4a0648c-3df9-48a7-85e6-160a56576bc9' });

    expect(mockDeleteMemory).toHaveBeenCalledWith('a4a0648c-3df9-48a7-85e6-160a56576bc9');
    expect(result).toEqual({ id: 'a4a0648c-3df9-48a7-85e6-160a56576bc9', deleted: true });
  });

  it('propagates the explicit not-found error', async () => {
    mockDeleteMemory.mockRejectedValue(new Error('Memory not found: missing-id'));

    await expect(handleDeleteMemory({ id: 'missing-id' })).rejects.toThrow('Memory not found: missing-id');
  });
});
