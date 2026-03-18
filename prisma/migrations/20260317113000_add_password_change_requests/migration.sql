CREATE TABLE `password_change_requests` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `newPasswordHash` VARCHAR(191) NOT NULL,
  `requestedByTokenHash` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `consumedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,

  UNIQUE INDEX `password_change_requests_tokenHash_key`(`tokenHash`),
  INDEX `password_change_requests_userId_idx`(`userId`),
  INDEX `password_change_requests_expiresAt_idx`(`expiresAt`),
  INDEX `password_change_requests_consumedAt_idx`(`consumedAt`),
  INDEX `password_change_requests_revokedAt_idx`(`revokedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `password_change_requests`
  ADD CONSTRAINT `password_change_requests_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
