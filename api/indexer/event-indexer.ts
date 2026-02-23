import { EventId, SuiClient, SuiEvent, SuiEventFilter } from '@mysten/sui.js/client';
import { CONFIG } from '../config';
import { getClient } from '../sui-utils';
import { CursorModel } from '../models/cursor';
import { handleEscrowObjects } from './escrow-handler';
import { handleLockObjects } from './locked-handler';

type SuiEventsCursor = EventId | null | undefined;

type EventTracker = {
  type: string;
  filter: SuiEventFilter;
  callback: (events: SuiEvent[], type: string) => Promise<void>;
};

const EVENTS_TO_TRACK: EventTracker[] = [
  {
    type: `${CONFIG.SWAP_CONTRACT.packageId}::lock`,
    filter: {
      MoveEventModule: {
        module: 'lock',
        package: CONFIG.SWAP_CONTRACT.packageId!,
      },
    },
    callback: handleLockObjects,
  },
  {
    type: `${CONFIG.SWAP_CONTRACT.packageId}::shared`,
    filter: {
      MoveEventModule: {
        module: 'shared',
        package: CONFIG.SWAP_CONTRACT.packageId!,
      },
    },
    callback: handleEscrowObjects,
  },
];

// ── Cursor helpers (Mongoose instead of Prisma) ──────────────────────────────

const getLatestCursor = async (tracker: EventTracker) => {
  const cursor = await CursorModel.findOne({ id: tracker.type }).lean();
  return cursor
    ? { eventSeq: cursor.eventSeq, txDigest: cursor.txDigest }
    : undefined;
};

const saveLatestCursor = async (tracker: EventTracker, cursor: EventId) => {
  await CursorModel.updateOne(
    { id: tracker.type },
    { $set: { eventSeq: cursor.eventSeq, txDigest: cursor.txDigest } },
    { upsert: true },
  );
};

// ── Polling loop (unchanged from Prisma version) ─────────────────────────────

const executeEventJob = async (
  client: SuiClient,
  tracker: EventTracker,
  cursor: SuiEventsCursor,
) => {
  try {
    const { data, hasNextPage, nextCursor } = await client.queryEvents({
      query: tracker.filter,
      cursor,
      order: 'ascending',
    });

    await tracker.callback(data, tracker.type);

    if (nextCursor && data.length > 0) {
      await saveLatestCursor(tracker, nextCursor);
      return { cursor: nextCursor, hasNextPage };
    }
  } catch (e) {
    console.error(e);
  }
  return { cursor, hasNextPage: false };
};

const runEventJob = async (
  client: SuiClient,
  tracker: EventTracker,
  cursor: SuiEventsCursor,
) => {
  const result = await executeEventJob(client, tracker, cursor);
  setTimeout(
    () => runEventJob(client, tracker, result.cursor),
    result.hasNextPage ? 0 : CONFIG.POLLING_INTERVAL_MS,
  );
};

export const setupListeners = async () => {
  const client = getClient(CONFIG.NETWORK);
  for (const tracker of EVENTS_TO_TRACK) {
    const latest = await getLatestCursor(tracker);
    runEventJob(client, tracker, latest);
  }
};