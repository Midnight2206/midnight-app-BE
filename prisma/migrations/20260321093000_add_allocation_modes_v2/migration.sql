CREATE TABLE `allocation_modes` (
  `id` CHAR(36) NOT NULL,
  `scope` ENUM('SYSTEM', 'UNIT') NOT NULL,
  `ownerKey` VARCHAR(191) NOT NULL,
  `unitId` INT NULL,
  `code` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `nameNormalized` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `ruleCombinator` ENUM('ALL', 'ANY') NOT NULL DEFAULT 'ALL',
  `ruleConfig` JSON NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  UNIQUE INDEX `allocation_modes_owner_name_uk`(`ownerKey`, `nameNormalized`),
  UNIQUE INDEX `allocation_modes_owner_code_uk`(`ownerKey`, `code`),
  INDEX `allocation_modes_scope_unit_deleted_idx`(`scope`, `unitId`, `deletedAt`),
  INDEX `allocation_modes_created_by_idx`(`createdById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_modes`
  ADD CONSTRAINT `allocation_modes_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_modes_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `allocation_mode_categories` (
  `id` CHAR(36) NOT NULL,
  `modeId` CHAR(36) NOT NULL,
  `categoryId` INT NOT NULL,
  `quantity` INT NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  UNIQUE INDEX `allocation_mode_categories_mode_cat_uk`(`modeId`, `categoryId`),
  INDEX `allocation_mode_categories_mode_deleted_idx`(`modeId`, `deletedAt`),
  INDEX `allocation_mode_categories_category_idx`(`categoryId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_categories`
  ADD CONSTRAINT `allocation_mode_categories_modeId_fkey`
  FOREIGN KEY (`modeId`) REFERENCES `allocation_modes`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_categories_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `allocation_mode_types` (
  `modeId` CHAR(36) NOT NULL,
  `typeId` INT NOT NULL,

  INDEX `allocation_mode_types_type_idx`(`typeId`),
  PRIMARY KEY (`modeId`, `typeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_types`
  ADD CONSTRAINT `allocation_mode_types_modeId_fkey`
  FOREIGN KEY (`modeId`) REFERENCES `allocation_modes`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_types_typeId_fkey`
  FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `allocation_mode_military_includes` (
  `modeId` CHAR(36) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `allocation_mode_include_military_idx`(`militaryId`),
  PRIMARY KEY (`modeId`, `militaryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_military_includes`
  ADD CONSTRAINT `allocation_mode_military_includes_modeId_fkey`
  FOREIGN KEY (`modeId`) REFERENCES `allocation_modes`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_military_includes_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `allocation_mode_military_excludes` (
  `modeId` CHAR(36) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `allocation_mode_exclude_military_idx`(`militaryId`),
  PRIMARY KEY (`modeId`, `militaryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_military_excludes`
  ADD CONSTRAINT `allocation_mode_military_excludes_modeId_fkey`
  FOREIGN KEY (`modeId`) REFERENCES `allocation_modes`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_military_excludes_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `allocation_mode_issue_vouchers` (
  `id` CHAR(36) NOT NULL,
  `unitId` INT NOT NULL,
  `warehouseId` INT NOT NULL,
  `modeId` CHAR(36) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `issuedAt` DATETIME(3) NOT NULL,
  `issuedYear` INT NOT NULL,
  `note` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `allocation_mode_vouchers_unit_year_idx`(`unitId`, `issuedYear`),
  INDEX `allocation_mode_vouchers_mode_issued_idx`(`modeId`, `issuedAt`),
  INDEX `allocation_mode_vouchers_military_issued_idx`(`militaryId`, `issuedAt`),
  INDEX `allocation_mode_vouchers_warehouse_idx`(`warehouseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_issue_vouchers`
  ADD CONSTRAINT `allocation_mode_issue_vouchers_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_vouchers_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_vouchers_modeId_fkey`
  FOREIGN KEY (`modeId`) REFERENCES `allocation_modes`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_vouchers_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_vouchers_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `allocation_mode_issue_voucher_items` (
  `id` CHAR(36) NOT NULL,
  `voucherId` CHAR(36) NOT NULL,
  `modeCategoryId` CHAR(36) NOT NULL,
  `categoryId` INT NOT NULL,
  `appliedTypeId` INT NULL,
  `quantity` INT NOT NULL,
  `serviceLifeYears` INT NOT NULL,
  `lastIssuedYear` INT NULL,
  `nextEligibleYear` INT NULL,
  `wasDue` BOOLEAN NOT NULL DEFAULT FALSE,
  `categoryName` VARCHAR(191) NOT NULL,
  `unitOfMeasureName` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `allocation_mode_voucher_items_voucher_idx`(`voucherId`),
  INDEX `allocation_mode_voucher_items_category_link_idx`(`modeCategoryId`),
  INDEX `allocation_mode_voucher_items_category_idx`(`categoryId`),
  INDEX `allocation_mode_voucher_items_type_idx`(`appliedTypeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_issue_voucher_items`
  ADD CONSTRAINT `allocation_mode_issue_voucher_items_voucherId_fkey`
  FOREIGN KEY (`voucherId`) REFERENCES `allocation_mode_issue_vouchers`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_voucher_items_modeCategoryId_fkey`
  FOREIGN KEY (`modeCategoryId`) REFERENCES `allocation_mode_categories`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_voucher_items_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_voucher_items_appliedTypeId_fkey`
  FOREIGN KEY (`appliedTypeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
