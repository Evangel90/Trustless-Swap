import { Schema, model } from 'mongoose';

const CursorSchema = new Schema({
  // 'id' is the tracker type string, e.g. '0xABC::lock'
  id:        { type: String, unique: true, required: true },
  eventSeq:  { type: String, required: true },
  txDigest:  { type: String, required: true },
});

export const CursorModel = model('Cursor', CursorSchema);