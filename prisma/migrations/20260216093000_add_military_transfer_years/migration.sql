ALTER TABLE `militaries`
  ADD COLUMN `unitTransferInYear` INTEGER NULL,
  ADD COLUMN `unitTransferOutYear` INTEGER NULL;

UPDATE `militaries`
SET `unitTransferInYear` = `initialCommissioningYear`
WHERE `unitTransferInYear` IS NULL;

ALTER TABLE `militaries`
  MODIFY `unitTransferInYear` INTEGER NOT NULL;

CREATE INDEX `militaries_unitId_unitTransferInYear_unitTransferOutYear_idx`
ON `militaries`(`unitId`, `unitTransferInYear`, `unitTransferOutYear`);
