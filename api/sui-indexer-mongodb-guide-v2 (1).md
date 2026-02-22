# Building a Sui Event Indexer from Scratch with MongoDB & Mongoose

**Updated for @mysten/sui v2.0 with SuiGraphQLClient**

This guide walks you through building a complete event indexer for the Sui Trustless Swap contract — from an empty folder to a running service that polls the Sui network via GraphQL, processes on-chain events, and persists them to MongoDB.

> **Note:** This guide uses the `SuiGraphQLClient` from `@mysten/sui v2.0+`, which provides a clean, type-safe way to query events using GraphQL. GraphQL offers better querying capabilities and clearer response structures compared to the older JSON-RPC API.

---

## What You're Building

The Sui blockchain emits **events** when smart contract actions occur (e.g., an escrow is created, swapped, or cancelled). Your indexer's job is to:

1. **Poll** the Sui GraphQL endpoint for new events at a regular interval
2. **Process** each event and extract the relevant data
3. **Persist** that data to MongoDB so your app can query it
4. **Remember its cursor** — the last event it saw — so it can resume after a restart without re-processing everything

The final file structure will look like this:

```
api/
├── indexer/
│   ├── escrow-handler.ts      # Processes escrow events
│   ├── locked-handler.ts      # Processes lock events
│   └── event-indexer.ts       # Main polling loop
├── models/
│   ├── escrow.ts              # Mongoose Escrow model
│   ├── locked.ts              # Mongoose Locked model
│   └── cursor.ts              # Mongoose Cursor model (for resume)
├── config.ts                  # Contract addresses + config
├── sui-utils.ts               # SuiGraphQLClient factory
└── indexer.ts                 # Entry point
```

---

## Prerequisites

- Node.js 18+
- A MongoDB instance (local or [MongoDB Atlas](https://www.mongodb.com/atlas))
- The deployed Sui Trustless Swap package ID

---

## Step 1 — Project Setup

Create the project and install dependencies.

```bash
mkdir sui-indexer && cd sui-indexer
npm init -y
npm install @mysten/sui mongoose dotenv
npm install -D typescript ts-node @types/node
npx tsc --init
```

Update your `tsconfig.json` to at least have:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./",
    "resolveJsonModule": true
  }
}
```

Create a `.env` file in the root:

```env
MONGO_URI=mongodb://localhost:27017/sui-indexer
# or for Atlas:
# MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/sui-indexer
```

---

## Step 2 — Config & Sui Client

These two small files wire up your contract address and the Sui GraphQL client.

**`api/config.ts`**

```ts
export const CONFIG = {
  // Replace with your deployed package ID
  SWAP_CONTRACT: {
    packageId: '0xYOUR_PACKAGE_ID_HERE',
  },

  // Which network to connect to: 'mainnet' | 'testnet' | 'devnet' | 'localnet'
  NETWORK: 'testnet' as const,

  // How long to wait between polls when there are no new events (ms)
  POLLING_INTERVAL_MS: 3000,
};
```

**`api/sui-utils.ts`**

This creates a `SuiGraphQLClient` pointed at the right network. The GraphQL client provides a powerful query interface with type-safe responses.

```ts
import { SuiGraphQLClient } from '@mysten/sui/graphql';

type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

// Network-to-URL mapping for GraphQL endpoints
const GRAPHQL_URLS: Record<Network, string> = {
  mainnet: 'https://sui-mainnet.mystenlabs.com/graphql',
  testnet: 'https://sui-testnet.mystenlabs.com/graphql',
  devnet: 'https://sui-devnet.mystenlabs.com/graphql',
  localnet: 'http://127.0.0.1:9125/graphql',
};

export const getClient = (network: Network): SuiGraphQLClient => {
  return new SuiGraphQLClient({
    url: GRAPHQL_URLS[network],
  });
};
```

---

## Step 3 — Mongoose Models

Mongoose models define the shape of your data in MongoDB. You need three collections:

- **Escrow** — stores escrow objects created, swapped, or cancelled on-chain
- **Locked** — stores locked objects created or destroyed on-chain
- **Cursor** — stores the last event cursor per tracker so you can resume after a restart

Create an `api/models/` folder and add each file:

---

**`api/models/cursor.ts`**

The cursor is the most important model. Sui's GraphQL API returns an `endCursor` that tells you where to continue from on the next poll. Without storing this, your indexer would re-process all historical events on every restart.

```ts
import { Schema, model } from 'mongoose';

const CursorSchema = new Schema({
  // 'id' is the tracker type string, e.g. '0xABC::lock'
  id:     { type: String, unique: true, required: true },
  cursor: { type: String, required: true }, // The endCursor from GraphQL
});

export const CursorModel = model('Cursor', CursorSchema);
```

---

**`api/models/escrow.ts`**

Mirrors the fields emitted by the `EscrowCreated`, `EscrowSwapped`, and `EscrowCancelled` Move events.

```ts
import { Schema, model } from 'mongoose';

const EscrowSchema = new Schema(
  {
    objectId:  { type: String, unique: true, index: true, required: true },
    sender:    { type: String, index: true },
    recipient: { type: String, index: true },
    keyId:     { type: String },
    itemId:    { type: String },
    swapped:   { type: Boolean, default: false },
    cancelled: { type: Boolean, default: false },
  },
  {
    // Automatically manages 'createdAt' and 'updatedAt' fields
    timestamps: true,
  },
);

export const EscrowModel = model('Escrow', EscrowSchema);
```

---

**`api/models/locked.ts`**

Mirrors the fields emitted by the `LockCreated` and `LockDestroyed` Move events.

```ts
import { Schema, model } from 'mongoose';

const LockedSchema = new Schema(
  {
    objectId: { type: String, unique: true, index: true, required: true },
    keyId:    { type: String },
    creator:  { type: String, index: true },
    itemId:   { type: String },
    deleted:  { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  },
);

export const LockedModel = model('Locked', LockedSchema);
```

---

## Step 4 — Event Handlers

Handlers receive a batch of events from the GraphQL response and write them to MongoDB. The key pattern is:

1. Loop over the events and **build an in-memory `updates` map** keyed by object ID
2. Apply whichever fields each event type provides to that map entry
3. Do a **single bulk upsert** at the end (create if not exists, update if it does)

This batching approach is important — a single poll may return multiple events for the same object (e.g., an escrow that was created and then cancelled in the same batch), and you want to collapse those into one DB write.

---

**`api/indexer/escrow-handler.ts`**

```ts
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
```

---

**`api/indexer/locked-handler.ts`**

Same pattern, but for the `lock` module events.

```ts
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
```

---

## Step 5 — The Event Indexer (Polling Loop)

This is the heart of the indexer. It defines which contract modules to watch, polls Sui for new events using GraphQL, hands them to the right handler, and saves the cursor so it can resume.

**How the cursor works:**

Sui's GraphQL `events` query response looks like this:

```ts
{
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  },
  nodes: GraphQLEvent[]
}
```

- `nodes` is the batch of events
- `hasNextPage` tells you if there are more events to fetch *right now* (before waiting)
- `endCursor` is the position to continue from next time

You save `endCursor` to MongoDB after each successful page. On the next run (or restart), you load it and pass it back as the `after` parameter.

---

**`api/indexer/event-indexer.ts`**

```ts
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
  const doc = await CursorModel.findOne({ id: tracker.id }).lean();
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

    const events = result.data?.events?.nodes ?? [];
    const pageInfo = result.data?.events?.pageInfo;
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
```

---

## Step 6 — Entry Point

This is the file you run. It connects to MongoDB, then starts the listeners.

**`api/indexer.ts`**

```ts
import 'dotenv/config';
import mongoose from 'mongoose';
import { setupListeners } from './indexer/event-indexer';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI environment variable is not set. Check your .env file.');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  console.log('Starting event listeners...');
  await setupListeners();
  console.log('Indexer running. Listening for events...');

  // Keep the process alive — the polling loop runs via setTimeout
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

Add a script to `package.json` so you can run it easily:

```json
{
  "scripts": {
    "indexer": "ts-node api/indexer.ts"
  }
}
```

---

## Step 7 — Run It

```bash
npm run indexer
```

You should see output like:

```
Connecting to MongoDB...
Connected to MongoDB.
Starting event listeners...
[0xABC::lock]   Starting from cursor: beginning
[0xABC::shared] Starting from cursor: beginning
Indexer running. Listening for events...
```

After it runs for a bit, you can open a MongoDB client (e.g., [MongoDB Compass](https://www.mongodb.com/products/compass)) and inspect your collections:

- `cursors` — one document per tracker, storing the `endCursor`
- `escrows` — one document per escrow object
- `lockeds` — one document per locked object

---

## How It All Connects (Summary)

```
Sui Network (GraphQL endpoint)
       │
       │  GraphQL query with eventType filter + cursor
       ▼
event-indexer.ts  ◄─── cursor loaded from MongoDB on startup
       │
       │  batch of GraphQLEvent[]
       ├──────────────────────────────────┐
       ▼                                  ▼
escrow-handler.ts               locked-handler.ts
       │                                  │
       │  EscrowModel.updateOne(upsert)   │  LockedModel.updateOne(upsert)
       ▼                                  ▼
           MongoDB (escrows + lockeds collections)

event-indexer.ts also saves endCursor ──► MongoDB (cursors collection)
```

---

## Advantages of GraphQL Over gRPC

✅ **Cleaner query syntax** - Write readable GraphQL queries instead of filter objects  
✅ **Flexible field selection** - Request only the fields you need  
✅ **Better error handling** - GraphQL responses include detailed error messages  
✅ **Type-safe responses** - The response structure matches your query exactly  
✅ **Simpler cursor management** - Single string cursor instead of compound object  
✅ **No type definition issues** - Work directly with the response structure  

---

## Useful Tips

**Resetting the indexer** — If you want to re-index from scratch, delete the cursor documents:

```js
// In a mongo shell or Compass
db.cursors.deleteMany({})
```

**Checking for errors silently** — The `executeEventJob` catches errors and retries on the next poll. In production, you'd want to forward these to a logging service or alert on repeated failures.

**Scaling up** — Each tracker runs its own independent `setTimeout` loop. If you have many modules to track, they all run concurrently without blocking each other.

**GraphQL query customization** — You can modify the GraphQL query to fetch additional fields:

```graphql
nodes {
  sender { address }
  timestamp
  transactionModule {
    package { address }
    name
  }
  contents {
    type { repr }
    json
    bcs
  }
}
```

**Pagination** — The `first` parameter controls how many events to fetch per page (default is 50). Increase this if you want larger batches, but be mindful of response size.

---

## Next Steps

- **Add more modules**: Expand `EVENTS_TO_TRACK` to index other contract modules
- **Add a REST API**: Build Express endpoints that query your MongoDB collections
- **Error monitoring**: Forward exceptions to a service like Sentry or Datadog
- **Rate limiting**: Add exponential backoff if you hit API limits
- **Multi-network support**: Run separate indexers for mainnet and testnet

You now have a production-ready event indexer using GraphQL!