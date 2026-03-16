CREATE TABLE `military_units` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `militaryId` VARCHAR(191) NOT NULL,
  `unitId` INTEGER NOT NULL,
  `transferInYear` INTEGER NOT NULL,
  `transferOutYear` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `military_units_militaryId_unitId_transferInYear_key`(`militaryId`, `unitId`, `transferInYear`),
  INDEX `military_units_militaryId_idx`(`militaryId`),
  INDEX `military_units_unitId_idx`(`unitId`),
  INDEX `military_units_unitId_transferInYear_transferOutYear_idx`(`unitId`, `transferInYear`, `transferOutYear`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `military_units` (`militaryId`, `unitId`, `transferInYear`, `transferOutYear`, `createdAt`, `updatedAt`)
SELECT
  m.`id`,
  m.`unitId`,
  COALESCE(m.`unitTransferInYear`, m.`initialCommissioningYear`),
  m.`unitTransferOutYear`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `militaries` m
WHERE m.`deletedAt` IS NULL;

ALTER TABLE `military_units`
  ADD CONSTRAINT `military_units_militaryId_fkey` FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `military_units_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX `militaries_unitId_unitTransferInYear_unitTransferOutYear_idx` ON `militaries`;

ALTER TABLE `militaries`
  DROP COLUMN `unitTransferInYear`,
  DROP COLUMN `unitTransferOutYear`;
