import type { SuiClientTypes } from '@mysten/sui/client';
import { EscrowModel } from '../models/escrow';

// The actual event structure from queryEvents includes these fields
// We extend the base Event type to include the fields we need
type SuiEvent = {
  type: string;
  parsedJson: unknown;
  // Other fields available: id, packageId, sender, bcs, timestampMs
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

// Union type — we'll narrow it based on event.type below
type EscrowEvent = EscrowCreated | EscrowSwapped | EscrowCancelled;

export const handleEscrowObjects = async (
  events: SuiEvent[],
  type: string,
): Promise<void> => {
  // We accumulate all changes for a given escrow_id here
  // before writing, so multiple events for the same object
  // are collapsed into one DB operation.
  const updates: Record<string, Record<string, unknown>> = {};

  for (const event of events) {
    // Safety check: make sure this event actually came from the
    // module we're tracking, not some other module that slipped in.
    if (!event.type.startsWith(type)) {
      throw new Error(`Invalid event module origin: ${event.type}`);
    }

    const data = event.parsedJson as EscrowEvent;
    const id = (data as EscrowCreated).escrow_id;

    // Initialize entry for this escrow if we haven't seen it yet
    if (!Object.hasOwn(updates, id)) {
      updates[id] = { objectId: id };
    }

    // --- Narrow on the specific event type and apply fields ---

    if (event.type.endsWith('::EscrowCancelled')) {
      updates[id].cancelled = true;
      continue;
    }

    if (event.type.endsWith('::EscrowSwapped')) {
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