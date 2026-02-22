import { LockedModel } from '../models/locked';

type GraphQLEvent = {
  contents: {
    type: { repr: string };
    json: unknown;
  };
  sender: { address: string };
};

type LockCreated = {
  lock_id:  string;
  key_id:   string;
  creator:  string;
  item_id:  string;
};

type LockDestroyed = {
  lock_id: string;
};

type LockedEvent = LockCreated | LockDestroyed;

export const handleLockObjects = async (
  events: GraphQLEvent[],
  moduleType: string,
): Promise<void> => {
  const updates: Record<string, Record<string, unknown>> = {};

  for (const event of events) {
    const eventType = event.contents.type.repr;

    if (!eventType.startsWith(moduleType)) {
      throw new Error(`Invalid event module origin: ${eventType}`);
    }

    const data = event.contents.json as LockedEvent;
    const id = (data as LockCreated).lock_id;

    if (!Object.hasOwn(updates, id)) {
      updates[id] = { objectId: id };
    }

    if (eventType.endsWith('::LockDestroyed')) {
      updates[id].deleted = true;
      continue;
    }

    // LockCreated
    const created = data as LockCreated;
    updates[id].keyId   = created.key_id;
    updates[id].creator = created.creator;
    updates[id].itemId  = created.item_id;
  }

  await Promise.all(
    Object.values(updates).map((update) =>
      LockedModel.updateOne(
        { objectId: update.objectId },
        { $set: update },
        { upsert: true },
      ),
    ),
  );
};