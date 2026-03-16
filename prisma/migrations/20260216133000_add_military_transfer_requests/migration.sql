CREATE TABLE `military_transfer_requests` (
  `id` VARCHAR(191) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `fromUnitId` INTEGER NOT NULL,
  `toUnitId` INTEGER NOT NULL,
  `transferYear` INTEGER NOT NULL,
  `note` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedByUserId` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `cancelledByUserId` VARCHAR(191) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `pendingFlag` TINYINT GENERATED ALWAYS AS (IF(`status` = 'PENDING', 1, NULL)) STORED,

  INDEX `military_transfer_requests_militaryId_status_idx`(`militaryId`, `status`),
  INDEX `military_transfer_requests_fromUnitId_status_idx`(`fromUnitId`, `status`),
  INDEX `military_transfer_requests_toUnitId_status_idx`(`toUnitId`, `status`),
  UNIQUE INDEX `military_transfer_requests_militaryId_pendingFlag_key`(`militaryId`, `pendingFlag`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `military_transfer_requests`
  ADD CONSTRAINT `military_transfer_requests_militaryId_fkey` FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `military_transfer_requests_fromUnitId_fkey` FOREIGN KEY (`fromUnitId`) REFERENCES `units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `military_transfer_requests_toUnitId_fkey` FOREIGN KEY (`toUnitId`) REFERENCES `units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
