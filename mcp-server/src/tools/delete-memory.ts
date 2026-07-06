import { deleteMemory } from '../db/queries.js';

export async function handleDeleteMemory(params: { id: string }) {
  const result = await deleteMemory(params.id);
  return { id: result.id, deleted: true };
}
