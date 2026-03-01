-- CreateTable
CREATE TABLE "Locked" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lockId" TEXT NOT NULL,
    "keyId" TEXT,
    "creator" TEXT,
    "itemId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Escrow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "escrowId" TEXT NOT NULL,
    "sender" TEXT,
    "recipient" TEXT,
    "keyId" TEXT,
    "itemId" TEXT,
    "swapped" BOOLEAN NOT NULL DEFAULT false,
    "cancelled" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Cursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventSeq" TEXT NOT NULL,
    "txDigest" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Locked_lockId_key" ON "Locked"("lockId");

-- CreateIndex
CREATE INDEX "Locked_creator_idx" ON "Locked"("creator");

-- CreateIndex
CREATE INDEX "Locked_deleted_idx" ON "Locked"("deleted");

-- CreateIndex
CREATE UNIQUE INDEX "Escrow_escrowId_key" ON "Escrow"("escrowId");

-- CreateIndex
CREATE INDEX "Escrow_recipient_idx" ON "Escrow"("recipient");

-- CreateIndex
CREATE INDEX "Escrow_sender_idx" ON "Escrow"("sender");
