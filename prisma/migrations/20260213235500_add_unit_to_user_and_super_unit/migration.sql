-- Ensure unit id=1 is reserved for SUPER_ADMIN scope
INSERT INTO `units` (`id`, `name`, `nameNormalized`, `createdAt`, `updatedAt`)
VALUES (1, 'superUnit', 'superunit', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `nameNormalized` = VALUES(`nameNormalized`),
  `deletedAt` = NULL,
  `updatedAt` = NOW();

ALTER TABLE `users`
  ADD COLUMN `unitId` INTEGER NULL;

-- Backfill user.unitId from claimed military records first
UPDATE `users` u
JOIN `militaries` m ON m.`claimedByUserId` = u.`id` AND m.`deletedAt` IS NULL
SET u.`unitId` = m.`unitId`
WHERE u.`unitId` IS NULL;

-- Force SUPER_ADMIN users into unit 1
UPDATE `users` u
JOIN `UserRole` ur ON ur.`userId` = u.`id`
JOIN `Role` r ON r.`id` = ur.`roleId` AND r.`name` = 'SUPER_ADMIN'
SET u.`unitId` = 1;

-- Any remaining users fallback to super unit to satisfy NOT NULL
UPDATE `users`
SET `unitId` = 1
WHERE `unitId` IS NULL;

ALTER TABLE `users`
  MODIFY `unitId` INTEGER NOT NULL,
  ADD INDEX `users_unitId_idx` (`unitId`),
  ADD CONSTRAINT `users_unitId_fkey`
    FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
