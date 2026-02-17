import { Schema, model } from 'mongoose';

const LockedSchema = new Schema(
  {
    lockId: { type: String, unique: true, index: true, required: true },
    keyId:    { type: String },
    creator:  { type: String, index: true },
    itemId:   { type: String },
    // deleted:  { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
  },
);

export const LockedModel = model('Locked', LockedSchema);