CREATE TABLE `account_audit_logs` (
  `id` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `targetUserId` VARCHAR(191) NOT NULL,
  `action` ENUM('CREATE_ADMIN', 'ACTIVATE_ACCOUNT', 'DEACTIVATE_ACCOUNT', 'RESET_PASSWORD') NOT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `account_audit_logs_actorUserId_idx`(`actorUserId`),
  INDEX `account_audit_logs_targetUserId_idx`(`targetUserId`),
  INDEX `account_audit_logs_action_idx`(`action`),
  INDEX `account_audit_logs_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `account_audit_logs`
  ADD CONSTRAINT `account_audit_logs_actorUserId_fkey`
    FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  ADD CONSTRAINT `account_audit_logs_targetUserId_fkey`
    FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE;
