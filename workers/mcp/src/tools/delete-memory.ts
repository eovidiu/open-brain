import { deleteMemory, type Db } from 'open-brain-workers-shared';

export async function handleDeleteMemory(sql: Db, params: { id: string }) {
  const result = await deleteMemory(sql, params.id);
  return { id: result.id, deleted: true };
}
