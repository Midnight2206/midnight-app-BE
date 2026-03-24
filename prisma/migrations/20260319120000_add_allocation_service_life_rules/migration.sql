CREATE TABLE `supply_allocation_service_life_rules` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `unitId` INT NOT NULL,
  `typeId` INT NOT NULL,
  `categoryId` INT NOT NULL,
  `serviceLifeYears` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  UNIQUE INDEX `saslr_unit_type_cat_uk`(`unitId`, `typeId`, `categoryId`),
  INDEX `saslr_unit_deleted_idx`(`unitId`, `deletedAt`),
  INDEX `saslr_type_idx`(`typeId`),
  INDEX `saslr_category_idx`(`categoryId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supply_allocation_service_life_rules`
  ADD CONSTRAINT `supply_allocation_service_life_rules_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_service_life_rules_typeId_fkey`
  FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_service_life_rules_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `supply_allocation_issue_logs`
  ADD COLUMN `appliedTypeId` INT NULL AFTER `voucherId`;

CREATE INDEX `supply_allocation_issue_logs_appliedTypeId_idx`
  ON `supply_allocation_issue_logs`(`appliedTypeId`);

ALTER TABLE `supply_allocation_issue_logs`
  ADD CONSTRAINT `supply_allocation_issue_logs_appliedTypeId_fkey`
  FOREIGN KEY (`appliedTypeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `supply_allocation_issue_voucher_items`
  ADD COLUMN `appliedTypeId` INT NULL AFTER `itemId`,
  ADD COLUMN `appliedTypeCode` VARCHAR(191) NULL AFTER `appliedTypeId`,
  ADD COLUMN `appliedTypeName` VARCHAR(191) NULL AFTER `appliedTypeCode`;

CREATE INDEX `supply_allocation_issue_voucher_items_appliedTypeId_idx`
  ON `supply_allocation_issue_voucher_items`(`appliedTypeId`);

ALTER TABLE `supply_allocation_issue_voucher_items`
  ADD CONSTRAINT `supply_allocation_issue_voucher_items_appliedTypeId_fkey`
  FOREIGN KEY (`appliedTypeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
