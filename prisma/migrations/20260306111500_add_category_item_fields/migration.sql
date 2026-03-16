ALTER TABLE `categories`
  ADD COLUMN `code` VARCHAR(191) NULL,
  ADD COLUMN `unitOfMeasureId` INT NULL,
  ADD COLUMN `versionId` INT NULL,
  ADD COLUMN `colorId` INT NULL,
  ADD COLUMN `totalQuantity` INT NOT NULL DEFAULT 0,
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `categories`
  ADD UNIQUE INDEX `categories_code_key`(`code`),
  ADD INDEX `categories_unitOfMeasureId_idx`(`unitOfMeasureId`),
  ADD INDEX `categories_versionId_idx`(`versionId`),
  ADD INDEX `categories_colorId_idx`(`colorId`);

ALTER TABLE `categories`
  ADD CONSTRAINT `categories_unitOfMeasureId_fkey`
    FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unit_of_measures`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `categories_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `versions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `categories_colorId_fkey`
    FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
