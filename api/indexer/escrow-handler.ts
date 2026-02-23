import { SuiEvent } from '@mysten/sui.js/client';
import { EscrowModel } from '../models/escrow';

type EscrowCreated = {
  sender: string;
  recipient: string;
  escrow_id: string;
  key_id: string;
  item_id: string;
};
type EscrowSwapped   = { escrow_id: string };
type EscrowCancelled = { escrow_id: string };
type EscrowEvent     = EscrowCreated | EscrowSwapped | EscrowCancelled;

export const handleEscrowObjects = async (events: SuiEvent[], type: string) => {
  const updates: Record<string, any> = {};

  for (const event of events) {
    if (!event.type.startsWith(type)) throw new Error('Invalid event module origin');

    const data = event.parsedJson as EscrowEvent;
    const id   = (data as any).escrow_id;

    if (!Object.hasOwn(updates, id)) {
      updates[id] = { escrowId: id };
    }

    if (event.type.endsWith('::EscrowCancelled')) {
      updates[id].cancelled = true;
      continue;
    }
    if (event.type.endsWith('::EscrowSwapped')) {
      updates[id].swapped = true;
      continue;
    }

    // EscrowCreated
    const d = data as EscrowCreated;
    updates[id].sender    = d.sender;
    updates[id].recipient = d.recipient;
    updates[id].keyId     = d.key_id;
    updates[id].itemId    = d.item_id;
  }

  await Promise.all(
    Object.values(updates).map((u) =>
      EscrowModel.updateOne({ escrowId: u.escrowId }, { $set: u }, { upsert: true }),
    ),
  );
};