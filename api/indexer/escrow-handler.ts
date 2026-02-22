import { EscrowModel } from '../models/escrow';

// GraphQL event structure
type GraphQLEvent = {
  contents: {
    type: { repr: string };
    json: unknown;
  };
  sender: { address: string };
};

// --- Type definitions matching the Move event structs ---

type EscrowCreated = {
  sender:     string;
  recipient:  string;
  escrow_id:  string;
  key_id:     string;
  item_id:    string;
};

type EscrowSwapped = {
  escrow_id: string;
};

type EscrowCancelled = {
  escrow_id: string;
};

// Union type — we'll narrow it based on event type below
type EscrowEvent = EscrowCreated | EscrowSwapped | EscrowCancelled;

export const handleEscrowObjects = async (
  events: GraphQLEvent[],
  moduleType: string, // e.g., '0xABC::shared'
): Promise<void> => {
  // We accumulate all changes for a given escrow_id here
  // before writing, so multiple events for the same object
  // are collapsed into one DB operation.
  const updates: Record<string, Record<string, unknown>> = {};

  for (const event of events) {
    const eventType = event.contents.type.repr;

    // Safety check: make sure this event actually came from the
    // module we're tracking
    if (!eventType.startsWith(moduleType)) {
      throw new Error(`Invalid event module origin: ${eventType}`);
    }

    const data = event.contents.json as EscrowEvent;
    const id = (data as EscrowCreated).escrow_id;

    // Initialize entry for this escrow if we haven't seen it yet
    if (!Object.hasOwn(updates, id)) {
      updates[id] = { objectId: id };
    }

    // --- Narrow on the specific event type and apply fields ---

    if (eventType.endsWith('::EscrowCancelled')) {
      updates[id].cancelled = true;
      continue;
    }

    if (eventType.endsWith('::EscrowSwapped')) {
      updates[id].swapped = true;
      continue;
    }

    // If it's not Cancelled or Swapped, it must be EscrowCreated
    const created = data as EscrowCreated;
    updates[id].sender    = created.sender;
    updates[id].recipient = created.recipient;
    updates[id].keyId     = created.key_id;
    updates[id].itemId    = created.item_id;
  }

  // Bulk upsert: for each objectId, create the document if it
  // doesn't exist, or merge in the new fields if it does.
  await Promise.all(
    Object.values(updates).map((update) =>
      EscrowModel.updateOne(
        { objectId: update.objectId },   // filter: find by objectId
        { $set: update },                // update: apply all fields
        { upsert: true },                // create if not found
      ),
    ),
  );
};