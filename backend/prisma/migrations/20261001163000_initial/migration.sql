-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    CHECK (role IN ('DISTRIBUTOR','SALES_MANAGER'))
);

-- CreateTable
CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "creditLimitMinor" INTEGER NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    CONSTRAINT "Distributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (creditLimitMinor >= 0),
    CHECK (tier IN ('BRONZE','SILVER','GOLD'))
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "stockQuantity" INTEGER NOT NULL,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    CHECK (unitPriceMinor >= 0),
    CHECK (stockQuantity >= 0),
    CHECK (reservedQuantity >= 0 AND reservedQuantity <= stockQuantity)
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "distributorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Placed',
    "subtotalMinor" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (status IN ('Placed','PendingApproval','Confirmed','Rejected','Dispatched','Delivered','Cancelled')),
    CHECK (subtotalMinor >= 0),
    CHECK (discountPercent IN (0,3,6)),
    CHECK (discountMinor >= 0 AND discountMinor <= subtotalMinor),
    CHECK (totalMinor = subtotalMinor - discountMinor)
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineSubtotalMinor" INTEGER NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (quantity > 0),
    CHECK (unitPriceMinor >= 0),
    CHECK (lineSubtotalMinor = quantity * unitPriceMinor)
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (actorType IN ('USER','SYSTEM')),
    CHECK ((actorType = 'USER' AND actorUserId IS NOT NULL) OR (actorType = 'SYSTEM' AND actorUserId IS NULL)),
    CHECK ((fromStatus = 'Placed' AND toStatus IN ('Confirmed','PendingApproval','Cancelled')) OR (fromStatus = 'PendingApproval' AND toStatus IN ('Confirmed','Rejected','Cancelled')) OR (fromStatus = 'Confirmed' AND toStatus IN ('Dispatched','Cancelled')) OR (fromStatus = 'Dispatched' AND toStatus = 'Delivered'))
);

-- CreateTable
CREATE TABLE "PointsEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "distributorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesEntryId" TEXT,
    CONSTRAINT "PointsEntry_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PointsEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PointsEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "PointsEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ((kind = 'AWARD' AND pointsDelta >= 0 AND reversesEntryId IS NULL) OR (kind = 'REVERSAL' AND pointsDelta <= 0 AND reversesEntryId IS NOT NULL))
);

-- CreateTable
CREATE TABLE "ErpOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderEventId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "lastError" TEXT,
    CONSTRAINT "ErpOutbox_orderEventId_fkey" FOREIGN KEY ("orderEventId") REFERENCES "OrderEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (attemptCount >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_userId_key" ON "Distributor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Order_distributorId_status_idx" ON "Order"("distributorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_distributorId_idempotencyKey_key" ON "Order"("distributorId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointsEntry_reversesEntryId_key" ON "PointsEntry"("reversesEntryId");

-- CreateIndex
CREATE INDEX "PointsEntry_distributorId_createdAt_idx" ON "PointsEntry"("distributorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PointsEntry_orderId_kind_key" ON "PointsEntry"("orderId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ErpOutbox_orderEventId_key" ON "ErpOutbox"("orderEventId");

-- CreateIndex
CREATE INDEX "ErpOutbox_sentAt_nextAttemptAt_idx" ON "ErpOutbox"("sentAt", "nextAttemptAt");


-- Audit entries are immutable once written.
CREATE TRIGGER OrderEvent_no_update BEFORE UPDATE ON "OrderEvent" BEGIN SELECT RAISE(ABORT, 'Order events are append-only'); END;
CREATE TRIGGER OrderEvent_no_delete BEFORE DELETE ON "OrderEvent" BEGIN SELECT RAISE(ABORT, 'Order events are append-only'); END;
