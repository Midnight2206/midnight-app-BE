CREATE TABLE `print_templates` (
  `id` CHAR(36) NOT NULL,
  `unitId` INT NOT NULL,
  `type` ENUM('ALLOCATION_MODE_ISSUE_VOUCHER') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `activeVersionId` CHAR(36) NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  UNIQUE INDEX `print_templates_unit_type_uk`(`unitId`, `type`),
  INDEX `print_templates_unit_deleted_idx`(`unitId`, `deletedAt`),
  INDEX `print_templates_created_by_idx`(`createdById`),
  INDEX `print_templates_active_version_idx`(`activeVersionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `print_template_versions` (
  `id` CHAR(36) NOT NULL,
  `templateId` CHAR(36) NOT NULL,
  `versionNo` INT NOT NULL,
  `config` JSON NOT NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `print_template_versions_template_version_uk`(`templateId`, `versionNo`),
  INDEX `print_template_versions_created_by_idx`(`createdById`),
  INDEX `print_template_versions_template_created_idx`(`templateId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `print_template_versions`
  ADD CONSTRAINT `print_template_versions_templateId_fkey`
  FOREIGN KEY (`templateId`) REFERENCES `print_templates`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `print_template_versions_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `print_templates`
  ADD CONSTRAINT `print_templates_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `print_templates_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `print_templates_activeVersionId_fkey`
  FOREIGN KEY (`activeVersionId`) REFERENCES `print_template_versions`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `allocation_mode_issue_vouchers`
  ADD COLUMN `printTemplateType` ENUM('ALLOCATION_MODE_ISSUE_VOUCHER') NULL AFTER `militaryId`,
  ADD COLUMN `printTemplateId` CHAR(36) NULL AFTER `printTemplateType`,
  ADD COLUMN `printTemplateVersionId` CHAR(36) NULL AFTER `printTemplateId`,
  ADD COLUMN `printTemplateVersionNo` INT NULL AFTER `printTemplateVersionId`,
  ADD COLUMN `printTemplateSnapshot` JSON NULL AFTER `printTemplateVersionNo`;

ALTER TABLE `allocation_mode_issue_vouchers`
  ADD INDEX `allocation_mode_vouchers_print_template_idx`(`printTemplateId`),
  ADD INDEX `allocation_mode_vouchers_print_template_version_idx`(`printTemplateVersionId`);

ALTER TABLE `allocation_mode_issue_vouchers`
  ADD CONSTRAINT `allocation_mode_issue_vouchers_printTemplateId_fkey`
  FOREIGN KEY (`printTemplateId`) REFERENCES `print_templates`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `allocation_mode_issue_vouchers_printTemplateVersionId_fkey`
  FOREIGN KEY (`printTemplateVersionId`) REFERENCES `print_template_versions`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
