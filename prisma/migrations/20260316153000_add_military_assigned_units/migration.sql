CREATE TABLE `military_assigned_units` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `unitId` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `nameNormalized` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  UNIQUE INDEX `military_assigned_units_unitId_nameNormalized_key`(`unitId`, `nameNormalized`),
  INDEX `military_assigned_units_unitId_deletedAt_idx`(`unitId`, `deletedAt`),
  INDEX `military_assigned_units_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `military_assigned_units`
  ADD CONSTRAINT `military_assigned_units_unitId_fkey`
    FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
