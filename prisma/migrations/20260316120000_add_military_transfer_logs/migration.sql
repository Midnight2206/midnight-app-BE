CREATE TABLE `military_transfer_logs` (
  `id` VARCHAR(191) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `fromUnitId` INTEGER NULL,
  `fromExternalUnitName` VARCHAR(191) NULL,
  `toUnitId` INTEGER NULL,
  `toExternalUnitName` VARCHAR(191) NULL,
  `transferYear` INTEGER NOT NULL,
  `note` VARCHAR(191) NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `military_transfer_logs_militaryId_transferYear_idx`(`militaryId`, `transferYear`),
  INDEX `military_transfer_logs_fromUnitId_transferYear_idx`(`fromUnitId`, `transferYear`),
  INDEX `military_transfer_logs_toUnitId_transferYear_idx`(`toUnitId`, `transferYear`),
  INDEX `military_transfer_logs_createdByUserId_transferYear_idx`(`createdByUserId`, `transferYear`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `military_transfer_logs`
  ADD CONSTRAINT `military_transfer_logs_militaryId_fkey`
    FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `military_transfer_logs`
  ADD CONSTRAINT `military_transfer_logs_fromUnitId_fkey`
    FOREIGN KEY (`fromUnitId`) REFERENCES `units`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `military_transfer_logs`
  ADD CONSTRAINT `military_transfer_logs_toUnitId_fkey`
    FOREIGN KEY (`toUnitId`) REFERENCES `units`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `military_transfer_logs`
  ADD CONSTRAINT `military_transfer_logs_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
