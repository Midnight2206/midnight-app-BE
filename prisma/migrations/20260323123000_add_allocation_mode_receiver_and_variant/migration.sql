ALTER TABLE `allocation_mode_issue_vouchers`
  ADD COLUMN `receiverName` VARCHAR(191) NULL AFTER `militaryId`;

ALTER TABLE `allocation_mode_issue_voucher_items`
  ADD COLUMN `versionId` INT NULL AFTER `categoryId`,
  ADD COLUMN `colorId` INT NULL AFTER `versionId`,
  ADD COLUMN `versionName` VARCHAR(191) NULL AFTER `categoryName`,
  ADD COLUMN `colorName` VARCHAR(191) NULL AFTER `versionName`;
