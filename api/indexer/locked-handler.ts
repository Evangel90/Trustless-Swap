import { SuiEvent } from '@mysten/sui.js/client';
import { LockedModel } from '../models/locked';

type LockedCreated = {
  locked_id: string;
  key_id:    string;
  creator:   string;
  item_id:   string;
};
type LockedDestroyed = { locked_id: string };
type LockedEvent     = LockedCreated | LockedDestroyed;

export const handleLockObjects = async (events: SuiEvent[], type: string) => {
  const updates: Record<string, any> = {};

  for (const event of events) {
    if (!event.type.startsWith(type)) throw new Error('Invalid event module origin');

    const data = event.parsedJson as LockedEvent;
    const id   = (data as any).locked_id;

    if (!Object.hasOwn(updates, id)) {
      updates[id] = { lockId: id };
    }

    if (event.type.endsWith('::LockedDestroyed')) {
      updates[id].deleted = true;
      continue;
    }

    // LockedCreated
    const d = data as LockedCreated;
    updates[id].keyId   = d.key_id;
    updates[id].creator = d.creator;
    updates[id].itemId  = d.item_id;
  }

  await Promise.all(
    Object.values(updates).map((u) =>
      LockedModel.updateOne({ lockId: u.lockId }, { $set: u }, { upsert: true }),
    ),
  );
};