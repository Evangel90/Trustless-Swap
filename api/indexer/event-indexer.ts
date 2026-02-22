import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { CONFIG } from '../config';
import { getClient } from '../sui-utils';
import { CursorModel } from '../models/cursor';
import { handleEscrowObjects } from './escrow-handler';
import { handleLockObjects } from './locked-handler';

// GraphQL event structure
type GraphQLEvent = {
  contents: {
    type: { repr: string };
    json: unknown;
  };
  sender: { address: string };
};

type SuiEventsCursor = string | null | undefined;

// Describes one "thing to watch" — a module + a handler callback
type EventTracker = {
  // Unique string ID for this tracker (used as the cursor key in MongoDB)
  id: string;
  // The event type prefix to filter by (e.g., '0xABC::lock')
  typePrefix: string;
  // Called with each batch of events
  callback: (events: GraphQLEvent[], typePrefix: string) => Promise<void>;
};

// --- Define which events to track ---
const EVENTS_TO_TRACK: EventTracker[] = [
  {
    id: `${CONFIG.SWAP_CONTRACT.packageId}::lock`,
    typePrefix: `${CONFIG.SWAP_CONTRACT.packageId}::lock`,
    callback: handleLockObjects,
  },
  {
    id: `${CONFIG.SWAP_CONTRACT.packageId}::shared`,
    typePrefix: `${CONFIG.SWAP_CONTRACT.packageId}::shared`,
    callback: handleEscrowObjects,
  },
];

// --- Cursor helpers ---

const getLatestCursor = async (
  tracker: EventTracker,
): Promise<SuiEventsCursor> => {
  const doc = await CursorModel.findOne({ id: tracker.id }).lean() as any;
  return doc?.cursor ?? undefined;
};

const saveLatestCursor = async (
  tracker: EventTracker,
  cursor: string,
): Promise<void> => {
  await CursorModel.updateOne(
    { id: tracker.id },
    { $set: { cursor } },
    { upsert: true },
  );
};

// --- Core polling logic ---

type EventExecutionResult = {
  cursor: SuiEventsCursor;
  hasNextPage: boolean;
};

const executeEventJob = async (
  client: SuiGraphQLClient,
  tracker: EventTracker,
  cursor: SuiEventsCursor,
): Promise<EventExecutionResult> => {
  try {
    // Fetch a page of events from the Sui GraphQL endpoint
    const result = await client.query({
      query: `
        query QueryEvents($typePrefix: String, $first: Int, $after: String) {
          events(
            first: $first
            after: $after
            filter: { eventType: $typePrefix }
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              sender { address }
              contents {
                type { repr }
                json
              }
            }
          }
        }
      `,
      variables: {
        typePrefix: tracker.typePrefix,
        first: 50, // Fetch up to 50 events per page
        after: cursor,
      },
    });

    const events = (result.data as any)?.events?.nodes ?? [];
    const pageInfo = (result.data as any)?.events?.pageInfo;
    const hasNextPage = pageInfo?.hasNextPage ?? false;
    const nextCursor = pageInfo?.endCursor;

    // Pass the batch to the appropriate handler
    if (events.length > 0) {
      await tracker.callback(events, tracker.typePrefix);
    }

    // Only advance the cursor if we got a valid nextCursor
    if (nextCursor && events.length > 0) {
      await saveLatestCursor(tracker, nextCursor);
      return { cursor: nextCursor, hasNextPage };
    }
  } catch (e) {
    // Log the error but don't crash — the loop will retry on the next poll
    console.error(`[${tracker.id}] Error processing events:`, e);
  }

  return { cursor, hasNextPage: false };
};

const runEventJob = async (
  client: SuiGraphQLClient,
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
      `[${tracker.id}] Starting from cursor:`,
      savedCursor ?? 'beginning',
    );
    runEventJob(client, tracker, savedCursor);
  }
};