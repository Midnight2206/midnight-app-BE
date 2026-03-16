ALTER TABLE `militaries`
  ADD COLUMN `assignedUnitId` INTEGER NULL;

CREATE INDEX `militaries_assignedUnitId_idx` ON `militaries`(`assignedUnitId`);

ALTER TABLE `militaries`
  ADD CONSTRAINT `militaries_assignedUnitId_fkey`
    FOREIGN KEY (`assignedUnitId`) REFERENCES `military_assigned_units`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
