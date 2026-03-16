-- Ensure military_units supports per-type transfers
ALTER TABLE `military_units`
  ADD COLUMN `typeId` INTEGER NULL AFTER `militaryId`,
  DROP COLUMN `activeFlag`;

DROP INDEX `military_units_militaryId_activeFlag_key` ON `military_units`;
DROP INDEX `military_units_militaryId_unitId_transferInYear_key` ON `military_units`;

-- CreateTable
CREATE TABLE `military_unit_yearly_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `militaryId` VARCHAR(191) NOT NULL,
    `typeId` INTEGER NOT NULL,
    `unitId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'SYSTEM',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `military_unit_yearly_snapshots_unitId_typeId_year_idx`(`unitId`, `typeId`, `year`),
    INDEX `military_unit_yearly_snapshots_militaryId_typeId_unitId_year_idx`(`militaryId`, `typeId`, `unitId`, `year`),
    UNIQUE INDEX `military_unit_yearly_snapshots_militaryId_typeId_year_key`(`militaryId`, `typeId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Ensure military_transfer_requests supports per-type transfers
ALTER TABLE `military_transfer_requests`
  ADD COLUMN `typeId` INTEGER NULL AFTER `militaryId`;

UPDATE `military_transfer_requests` AS `r`
SET `typeId` = (
  SELECT MIN(`mta`.`typeId`)
  FROM `military_type_assignments` AS `mta`
  WHERE `mta`.`militaryId` = `r`.`militaryId`
);

UPDATE `military_transfer_requests`
SET `typeId` = (
  SELECT `id` FROM `military_type_catalogs` ORDER BY `id` ASC LIMIT 1
)
WHERE `typeId` IS NULL;

ALTER TABLE `military_transfer_requests`
  MODIFY `typeId` INTEGER NOT NULL,
  DROP COLUMN `pendingFlag`;

-- CreateIndex
CREATE INDEX `military_transfer_requests_militaryId_typeId_status_idx` ON `military_transfer_requests`(`militaryId`, `typeId`, `status`);

-- CreateIndex
CREATE INDEX `military_transfer_requests_militaryId_typeId_status_requeste_idx` ON `military_transfer_requests`(`militaryId`, `typeId`, `status`, `requestedAt`);

-- CreateIndex
CREATE INDEX `military_transfer_requests_fromUnitId_status_requestedAt_idx` ON `military_transfer_requests`(`fromUnitId`, `status`, `requestedAt`);

-- CreateIndex
CREATE INDEX `military_transfer_requests_toUnitId_status_requestedAt_idx` ON `military_transfer_requests`(`toUnitId`, `status`, `requestedAt`);

-- CreateIndex
CREATE INDEX `military_units_typeId_idx` ON `military_units`(`typeId`);

-- CreateIndex
CREATE INDEX `military_units_militaryId_typeId_idx` ON `military_units`(`militaryId`, `typeId`);

-- CreateIndex
CREATE INDEX `military_units_militaryId_typeId_transferOutYear_transferInY_idx` ON `military_units`(`militaryId`, `typeId`, `transferOutYear`, `transferInYear`);

-- CreateIndex
CREATE INDEX `military_units_militaryId_typeId_unitId_transferOutYear_tran_idx` ON `military_units`(`militaryId`, `typeId`, `unitId`, `transferOutYear`, `transferInYear`);

-- CreateIndex
CREATE UNIQUE INDEX `military_units_militaryId_typeId_unitId_transferInYear_key` ON `military_units`(`militaryId`, `typeId`, `unitId`, `transferInYear`);

-- CreateIndex
CREATE INDEX `size_registration_requests_periodId_status_idx` ON `size_registration_requests`(`periodId`, `status`);

-- AddForeignKey
ALTER TABLE `military_units` ADD CONSTRAINT `military_units_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_unit_yearly_snapshots` ADD CONSTRAINT `military_unit_yearly_snapshots_militaryId_fkey` FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_unit_yearly_snapshots` ADD CONSTRAINT `military_unit_yearly_snapshots_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_unit_yearly_snapshots` ADD CONSTRAINT `military_unit_yearly_snapshots_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_transfer_requests` ADD CONSTRAINT `military_transfer_requests_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
