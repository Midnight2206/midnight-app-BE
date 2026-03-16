ALTER TABLE `supply_allocation_issue_logs`
  ADD COLUMN `warehouseId` INT NULL AFTER `itemId`,
  ADD COLUMN `voucherId` CHAR(36) NULL AFTER `warehouseId`,
  ADD COLUMN `issuedYear` INT NULL AFTER `issuedAt`;

UPDATE `supply_allocation_issue_logs`
SET `issuedYear` = YEAR(`issuedAt`)
WHERE `issuedYear` IS NULL;

ALTER TABLE `supply_allocation_issue_logs`
  MODIFY COLUMN `issuedYear` INT NOT NULL;

CREATE TABLE `supply_allocation_issue_vouchers` (
  `id` CHAR(36) NOT NULL,
  `voucherNo` VARCHAR(64) NOT NULL,
  `unitId` INT NOT NULL,
  `warehouseId` INT NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `subjectId` INT NOT NULL,
  `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `issuedYear` INT NOT NULL,
  `note` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `supply_allocation_issue_vouchers_voucherNo_key`(`voucherNo`),
  INDEX `supply_allocation_issue_vouchers_unitId_issuedAt_idx`(`unitId`, `issuedAt`),
  INDEX `supply_allocation_issue_vouchers_warehouseId_issuedAt_idx`(`warehouseId`, `issuedAt`),
  INDEX `supply_allocation_issue_vouchers_militaryId_issuedAt_idx`(`militaryId`, `issuedAt`),
  INDEX `supply_allocation_issue_vouchers_subjectId_issuedAt_idx`(`subjectId`, `issuedAt`),
  INDEX `supply_allocation_issue_vouchers_createdById_idx`(`createdById`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supply_allocation_issue_vouchers`
  ADD CONSTRAINT `supply_allocation_issue_vouchers_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_issue_vouchers_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_issue_vouchers_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_issue_vouchers_subjectId_fkey`
  FOREIGN KEY (`subjectId`) REFERENCES `supply_allocation_subjects`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_issue_vouchers_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `supply_allocation_issue_voucher_items` (
  `id` CHAR(36) NOT NULL,
  `voucherId` CHAR(36) NOT NULL,
  `standardId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `quantity` INT NOT NULL,
  `itemName` VARCHAR(191) NOT NULL,
  `itemCode` VARCHAR(191) NULL,
  `unitOfMeasureName` VARCHAR(191) NULL,
  `categoryName` VARCHAR(191) NULL,
  `serviceLifeYears` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `supply_allocation_issue_voucher_items_voucherId_idx`(`voucherId`),
  INDEX `supply_allocation_issue_voucher_items_standardId_itemId_idx`(`standardId`, `itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supply_allocation_issue_voucher_items`
  ADD CONSTRAINT `supply_allocation_issue_voucher_items_voucherId_fkey`
  FOREIGN KEY (`voucherId`) REFERENCES `supply_allocation_issue_vouchers`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_issue_voucher_items_standardItem_fkey`
  FOREIGN KEY (`standardId`, `itemId`) REFERENCES `supply_allocation_standard_items`(`standardId`, `itemId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX `supply_allocation_issue_logs_warehouseId_issuedAt_idx`
  ON `supply_allocation_issue_logs`(`warehouseId`, `issuedAt`);
CREATE INDEX `supply_allocation_issue_logs_voucherId_idx`
  ON `supply_allocation_issue_logs`(`voucherId`);
CREATE INDEX `supply_allocation_issue_logs_issuedYear_idx`
  ON `supply_allocation_issue_logs`(`issuedYear`);

ALTER TABLE `supply_allocation_issue_logs`
  ADD CONSTRAINT `supply_allocation_issue_logs_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_issue_logs_voucherId_fkey`
  FOREIGN KEY (`voucherId`) REFERENCES `supply_allocation_issue_vouchers`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
