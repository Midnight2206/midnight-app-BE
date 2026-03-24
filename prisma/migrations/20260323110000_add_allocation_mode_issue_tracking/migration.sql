ALTER TABLE `allocation_mode_issue_vouchers`
  ADD COLUMN `voucherNo` VARCHAR(191) NULL;

CREATE TABLE `allocation_mode_military_category_statuses` (
  `id` CHAR(36) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `categoryId` INT NOT NULL,
  `latestIssuedYear` INT NOT NULL,
  `latestIssuedAt` DATETIME(3) NOT NULL,
  `lastVoucherId` CHAR(36) NULL,
  `lastModeId` CHAR(36) NULL,
  `lastQuantity` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `allocation_mode_military_category_status_uk`(`militaryId`, `categoryId`),
  INDEX `allocation_mode_category_status_category_idx`(`categoryId`),
  INDEX `allocation_mode_category_status_year_idx`(`latestIssuedYear`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `allocation_mode_military_category_statuses`
  ADD CONSTRAINT `allocation_mode_military_category_statuses_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_military_category_statuses_categoryId_fkey`
  FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE `allocation_mode_issue_vouchers`
SET `voucherNo` = CONCAT('PXK-', DATE_FORMAT(`issuedAt`, '%Y%m%d'), '-', LPAD(RIGHT(REPLACE(`id`, '-', ''), 6), 6, '0'))
WHERE `voucherNo` IS NULL;

ALTER TABLE `allocation_mode_issue_vouchers`
  MODIFY COLUMN `voucherNo` VARCHAR(191) NOT NULL,
  ADD UNIQUE INDEX `allocation_mode_issue_vouchers_voucherNo_key`(`voucherNo`);
