import { Schema, model } from 'mongoose';

const EscrowSchema = new Schema(
  {
    escrowId:  { type: String, unique: true, index: true, required: true },
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