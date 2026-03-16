CREATE TABLE IF NOT EXISTS `versions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `nameNormalized` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `versions_nameNormalized_key`(`nameNormalized`),
  INDEX `versions_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `colors` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `nameNormalized` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `colors_nameNormalized_key`(`nameNormalized`),
  INDEX `colors_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supply_items`
  ADD COLUMN `versionId` INT NULL,
  ADD COLUMN `colorId` INT NULL;

ALTER TABLE `supply_items`
  ADD INDEX `supply_items_versionId_idx`(`versionId`),
  ADD INDEX `supply_items_colorId_idx`(`colorId`);

ALTER TABLE `supply_items`
  ADD CONSTRAINT `supply_items_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `versions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_items_colorId_fkey`
    FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `versions` (`name`, `nameNormalized`, `createdAt`, `updatedAt`, `deletedAt`)
VALUES ('none', 'none', NOW(3), NOW(3), NULL);

INSERT IGNORE INTO `colors` (`name`, `nameNormalized`, `createdAt`, `updatedAt`, `deletedAt`)
VALUES ('none', 'none', NOW(3), NOW(3), NULL);
