import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiClientTypes } from '@mysten/sui/client';
import { CONFIG } from '../config';
import { getClient } from '../sui-utils';
import { CursorModel } from '../models/cursor';
import { handleEscrowObjects } from './escrow-handler';
import { handleLockObjects } from './locked-handler';

// Event structure from queryEvents response
type SuiEvent = {
  type: string;
  parsedJson: unknown;
};

// Use the official EventFilter type from SuiClientTypes
type SuiEventFilter = SuiClientTypes.EventFilter;

// Cursor type from Sui gRPC API
type EventId = {
  txDigest: string;
  eventSeq: string;
};

type SuiEventsCursor = EventId | null | undefined;

// Describes one "thing to watch" — a module filter + a handler callback
type EventTracker = {
  // Unique string ID for this tracker (used as the cursor key in MongoDB)
  type: string;
  // The filter passed to Sui's queryEvents API
  filter: SuiEventFilter;
  // Called with each batch of events
  callback: (events: SuiEvent[], type: string) => Promise<void>;
};

// --- Define which events to track ---
//
// MoveEventModule matches ALL events emitted by a specific module.
// This means if your module emits EscrowCreated, EscrowSwapped, and
// EscrowCancelled, you get all three with one filter — the handler
// then narrows by event.type.
//
const EVENTS_TO_TRACK: EventTracker[] = [
  {
    type: `${CONFIG.SWAP_CONTRACT.packageId}::lock`,
    filter: {
      MoveEventModule: {
        module: 'lock',
        package: CONFIG.SWAP_CONTRACT.packageId,
      },
    },
    callback: handleLockObjects,
  },
  {
    type: `${CONFIG.SWAP_CONTRACT.packageId}::shared`,
    filter: {
      MoveEventModule: {
        module: 'shared',
        package: CONFIG.SWAP_CONTRACT.packageId,
      },
    },
    callback: handleEscrowObjects,
  },
];

// --- Cursor helpers ---

const getLatestCursor = async (
  tracker: EventTracker,
): Promise<SuiEventsCursor> => {
  const doc = await CursorModel.findOne({ id: tracker.type }).lean();
  if (!doc) {
    // No cursor saved yet — start from the beginning of history
    return undefined;
  }
  return {
    eventSeq:  doc.eventSeq,
    txDigest:  doc.txDigest,
  };
};

const saveLatestCursor = async (
  tracker: EventTracker,
  cursor: EventId,
): Promise<void> => {
  await CursorModel.updateOne(
    { id: tracker.type },
    { $set: { eventSeq: cursor.eventSeq, txDigest: cursor.txDigest } },
    { upsert: true },
  );
};

// --- Core polling logic ---

type EventExecutionResult = {
  cursor: SuiEventsCursor;
  hasNextPage: boolean;
};

const executeEventJob = async (
  client: SuiGrpcClient,
  tracker: EventTracker,
  cursor: SuiEventsCursor,
): Promise<EventExecutionResult> => {
  try {
    // Fetch a page of events from the Sui gRPC endpoint
    const result = await client.queryEvents({
      query: tracker.filter,
      cursor,
      limit: 50, // Fetch up to 50 events per page (adjust as needed)
    });

    const events = result.events || [];
    const hasNextPage = result.hasNextPage ?? false;
    const nextCursor = result.nextCursor;

    // Pass the batch to the appropriate handler
    await tracker.callback(events, tracker.type);

    // Only advance the cursor if we actually got new events
    if (nextCursor && events.length > 0) {
      await saveLatestCursor(tracker, nextCursor);
      return { cursor: nextCursor, hasNextPage };
    }
  } catch (e) {
    // Log the error but don't crash — the loop will retry on the next poll
    console.error(`[${tracker.type}] Error processing events:`, e);
  }

  return { cursor, hasNextPage: false };
};

const runEventJob = async (
  client: SuiGrpcClient,
  tracker: EventTracker,
  cursor: SuiEventsCursor,
): Promise<void> => {
  const result = await executeEventJob(client, tracker, cursor);

  // If there are more pages available right now, fetch the next one immediately.
  // Otherwise, wait for POLLING_INTERVAL_MS before checking again.
  setTimeout(
    () => runEventJob(client, tracker, result.cursor),
    result.hasNextPage ? 0 : CONFIG.POLLING_INTERVAL_MS,
  );
};

// --- Public: call this once to start all trackers ---

export const setupListeners = async (): Promise<void> => {
  const client = getClient(CONFIG.NETWORK);

  for (const tracker of EVENTS_TO_TRACK) {
    // Resume from wherever we left off (or from the beginning if first run)
    const savedCursor = await getLatestCursor(tracker);
    console.log(
      `[${tracker.type}] Starting from cursor:`,
      savedCursor ?? 'beginning',
    );
    runEventJob(client, tracker, savedCursor);
  }
};