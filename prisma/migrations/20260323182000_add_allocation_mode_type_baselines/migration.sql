ALTER TABLE `allocation_mode_military_category_statuses`
  ADD COLUMN `typeId` INT NULL AFTER `categoryId`;

DELETE FROM `allocation_mode_military_category_statuses`;

ALTER TABLE `allocation_mode_military_category_statuses`
  DROP INDEX `allocation_mode_military_category_status_uk`,
  ADD UNIQUE INDEX `allocation_mode_military_category_status_uk`(`militaryId`, `categoryId`, `typeId`),
  ADD INDEX `allocation_mode_category_status_type_idx`(`typeId`);

ALTER TABLE `allocation_mode_military_category_statuses`
  ADD CONSTRAINT `allocation_mode_military_category_statuses_typeId_fkey`
  FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `allocation_mode_military_category_baselines` (
  `id` CHAR(36) NOT NULL,
  `unitId` INT NOT NULL,
  `militaryId` CHAR(36) NOT NULL,
  `categoryId` INT NOT NULL,
  `typeId` INT NOT NULL,
  `latestIssuedYear` INT NOT NULL,
  `importedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `allocation_mode_category_baselines_military_category_type_uk`(`militaryId`, `categoryId`, `typeId`),
  INDEX `allocation_mode_category_baselines_unit_type_idx`(`unitId`, `typeId`),
  INDEX `allocation_mode_category_baselines_category_idx`(`categoryId`),
  INDEX `allocation_mode_category_baselines_imported_by_idx`(`importedById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_military_category_baselines`
  ADD CONSTRAINT `allocation_mode_military_category_baselines_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_military_category_baselines_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_military_category_baselines_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_military_category_baselines_typeId_fkey`
  FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_military_category_baselines_importedById_fkey`
  FOREIGN KEY (`importedById`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
