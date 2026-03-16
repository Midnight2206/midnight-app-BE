-- Ensure inventory tables exist and scope warehouses by unit.
-- Handles both cases:
-- 1) Existing legacy warehouses table (global warehouses) -> convert to unit-scoped.
-- 2) No inventory tables yet -> create them directly in the new shape.

SET @db_name := DATABASE();

SET @has_warehouses := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = @db_name
    AND table_name = 'warehouses'
);

SET @sql := IF(
  @has_warehouses = 0,
  "CREATE TABLE `warehouses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `unitId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameNormalized` VARCHAR(191) NOT NULL,
    `isSystemDefault` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`)
  )",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_unit_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'warehouses'
    AND column_name = 'unitId'
);

SET @sql := IF(
  @has_unit_id = 0,
  "ALTER TABLE `warehouses` ADD COLUMN `unitId` INTEGER NULL",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @default_unit_id := (SELECT `id` FROM `units` ORDER BY `id` ASC LIMIT 1);

UPDATE `warehouses`
SET `unitId` = COALESCE(`unitId`, @default_unit_id)
WHERE `unitId` IS NULL;

SET @sql := IF(
  @has_unit_id = 0,
  "ALTER TABLE `warehouses` MODIFY `unitId` INTEGER NOT NULL",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_name_key := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db_name
    AND table_name = 'warehouses'
    AND index_name = 'warehouses_name_key'
);

SET @sql := IF(
  @has_idx_name_key > 0,
  "ALTER TABLE `warehouses` DROP INDEX `warehouses_name_key`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_name_normalized_key := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db_name
    AND table_name = 'warehouses'
    AND index_name = 'warehouses_nameNormalized_key'
);

SET @sql := IF(
  @has_idx_name_normalized_key > 0,
  "ALTER TABLE `warehouses` DROP INDEX `warehouses_nameNormalized_key`",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_warehouses_unit := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = @db_name
    AND table_name = 'warehouses'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'warehouses_unitId_fkey'
);

SET @sql := IF(
  @has_fk_warehouses_unit = 0,
  "ALTER TABLE `warehouses`
     ADD CONSTRAINT `warehouses_unitId_fkey`
     FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
     ON DELETE CASCADE
     ON UPDATE CASCADE",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_unit_name_normalized := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db_name
    AND table_name = 'warehouses'
    AND index_name = 'warehouses_unitId_nameNormalized_key'
);

SET @sql := IF(
  @has_idx_unit_name_normalized = 0,
  "CREATE UNIQUE INDEX `warehouses_unitId_nameNormalized_key`
   ON `warehouses`(`unitId`, `nameNormalized`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx_unit_deleted_at := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db_name
    AND table_name = 'warehouses'
    AND index_name = 'warehouses_unitId_deletedAt_idx'
);

SET @sql := IF(
  @has_idx_unit_deleted_at = 0,
  "CREATE INDEX `warehouses_unitId_deletedAt_idx`
   ON `warehouses`(`unitId`, `deletedAt`)",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_supply_items := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = @db_name
    AND table_name = 'supply_items'
);

SET @sql := IF(
  @has_supply_items = 0,
  "CREATE TABLE `supply_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `nameNormalized` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `categoryId` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    UNIQUE INDEX `supply_items_nameNormalized_key`(`nameNormalized`),
    UNIQUE INDEX `supply_items_code_key`(`code`),
    INDEX `supply_items_categoryId_deletedAt_idx`(`categoryId`, `deletedAt`),
    PRIMARY KEY (`id`)
  )",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_supply_items_category := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = @db_name
    AND table_name = 'supply_items'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'supply_items_categoryId_fkey'
);

SET @sql := IF(
  @has_fk_supply_items_category = 0,
  "ALTER TABLE `supply_items`
     ADD CONSTRAINT `supply_items_categoryId_fkey`
     FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
     ON DELETE RESTRICT
     ON UPDATE CASCADE",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_warehouse_stocks := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = @db_name
    AND table_name = 'warehouse_stocks'
);

SET @sql := IF(
  @has_warehouse_stocks = 0,
  "CREATE TABLE `warehouse_stocks` (
    `warehouseId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX `warehouse_stocks_itemId_idx`(`itemId`),
    PRIMARY KEY (`warehouseId`, `itemId`)
  )",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_warehouse_stocks_warehouse := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = @db_name
    AND table_name = 'warehouse_stocks'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'warehouse_stocks_warehouseId_fkey'
);

SET @sql := IF(
  @has_fk_warehouse_stocks_warehouse = 0,
  "ALTER TABLE `warehouse_stocks`
     ADD CONSTRAINT `warehouse_stocks_warehouseId_fkey`
     FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
     ON DELETE CASCADE
     ON UPDATE CASCADE",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_warehouse_stocks_item := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = @db_name
    AND table_name = 'warehouse_stocks'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'warehouse_stocks_itemId_fkey'
);

SET @sql := IF(
  @has_fk_warehouse_stocks_item = 0,
  "ALTER TABLE `warehouse_stocks`
     ADD CONSTRAINT `warehouse_stocks_itemId_fkey`
     FOREIGN KEY (`itemId`) REFERENCES `supply_items`(`id`)
     ON DELETE CASCADE
     ON UPDATE CASCADE",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_stock_adjustment_logs := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = @db_name
    AND table_name = 'stock_adjustment_logs'
);

SET @sql := IF(
  @has_stock_adjustment_logs = 0,
  "CREATE TABLE `stock_adjustment_logs` (
    `id` VARCHAR(191) NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `quantityBefore` INTEGER NOT NULL,
    `delta` INTEGER NOT NULL,
    `quantityAfter` INTEGER NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `stock_adjustment_logs_warehouseId_createdAt_idx`(`warehouseId`, `createdAt`),
    INDEX `stock_adjustment_logs_itemId_createdAt_idx`(`itemId`, `createdAt`),
    INDEX `stock_adjustment_logs_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
  )",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_stock_adjustment_logs_warehouse := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = @db_name
    AND table_name = 'stock_adjustment_logs'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'stock_adjustment_logs_warehouseId_fkey'
);

SET @sql := IF(
  @has_fk_stock_adjustment_logs_warehouse = 0,
  "ALTER TABLE `stock_adjustment_logs`
     ADD CONSTRAINT `stock_adjustment_logs_warehouseId_fkey`
     FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
     ON DELETE CASCADE
     ON UPDATE CASCADE",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_stock_adjustment_logs_item := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = @db_name
    AND table_name = 'stock_adjustment_logs'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'stock_adjustment_logs_itemId_fkey'
);

SET @sql := IF(
  @has_fk_stock_adjustment_logs_item = 0,
  "ALTER TABLE `stock_adjustment_logs`
     ADD CONSTRAINT `stock_adjustment_logs_itemId_fkey`
     FOREIGN KEY (`itemId`) REFERENCES `supply_items`(`id`)
     ON DELETE CASCADE
     ON UPDATE CASCADE",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk_stock_adjustment_logs_created_by := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = @db_name
    AND table_name = 'stock_adjustment_logs'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'stock_adjustment_logs_createdById_fkey'
);

SET @sql := IF(
  @has_fk_stock_adjustment_logs_created_by = 0,
  "ALTER TABLE `stock_adjustment_logs`
     ADD CONSTRAINT `stock_adjustment_logs_createdById_fkey`
     FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
     ON DELETE SET NULL
     ON UPDATE CASCADE",
  "SELECT 1"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
