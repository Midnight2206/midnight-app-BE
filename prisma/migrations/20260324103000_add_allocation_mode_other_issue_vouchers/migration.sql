ALTER TABLE `allocation_mode_issue_vouchers`
  DROP FOREIGN KEY `allocation_mode_issue_vouchers_modeId_fkey`,
  DROP FOREIGN KEY `allocation_mode_issue_vouchers_militaryId_fkey`,
  ADD COLUMN `purpose` ENUM('MODE', 'OTHER') NOT NULL DEFAULT 'MODE' AFTER `voucherNo`,
  MODIFY `modeId` CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `militaryId` VARCHAR(191) NULL,
  ADD COLUMN `reason` VARCHAR(1000) NULL AFTER `issuedYear`;

ALTER TABLE `allocation_mode_issue_voucher_items`
  DROP FOREIGN KEY `allocation_mode_issue_voucher_items_modeCategoryId_fkey`,
  MODIFY `modeCategoryId` CHAR(36) COLLATE utf8mb4_unicode_ci NULL;

ALTER TABLE `allocation_mode_issue_vouchers`
  ADD CONSTRAINT `allocation_mode_issue_vouchers_modeId_fkey`
    FOREIGN KEY (`modeId`) REFERENCES `allocation_modes` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_vouchers_militaryId_fkey`
    FOREIGN KEY (`militaryId`) REFERENCES `militaries` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `allocation_mode_issue_voucher_items`
  ADD CONSTRAINT `allocation_mode_issue_voucher_items_modeCategoryId_fkey`
    FOREIGN KEY (`modeCategoryId`) REFERENCES `allocation_mode_categories` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX `allocation_mode_vouchers_unit_purpose_year_idx`
  ON `allocation_mode_issue_vouchers`(`unitId`, `purpose`, `issuedYear`);
