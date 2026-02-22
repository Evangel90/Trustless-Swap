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