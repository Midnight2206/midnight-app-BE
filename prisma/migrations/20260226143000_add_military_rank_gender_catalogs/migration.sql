CREATE TABLE `military_rank_catalogs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(191) NOT NULL,
  `codeNormalized` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `military_rank_catalogs_codeNormalized_key`(`codeNormalized`),
  INDEX `military_rank_catalogs_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `military_gender_catalogs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(191) NOT NULL,
  `codeNormalized` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `military_gender_catalogs_codeNormalized_key`(`codeNormalized`),
  INDEX `military_gender_catalogs_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `military_gender_catalogs` (`code`, `codeNormalized`, `name`, `createdAt`, `updatedAt`)
VALUES
  ('MALE', 'MALE', 'Nam', NOW(3), NOW(3)),
  ('FEMALE', 'FEMALE', 'Nữ', NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `deletedAt` = NULL,
  `updatedAt` = NOW(3);

INSERT INTO `military_rank_catalogs` (`code`, `codeNormalized`, `name`, `createdAt`, `updatedAt`)
SELECT DISTINCT
  TRIM(`rank`) AS `code`,
  UPPER(TRIM(`rank`)) AS `codeNormalized`,
  TRIM(`rank`) AS `name`,
  NOW(3) AS `createdAt`,
  NOW(3) AS `updatedAt`
FROM `militaries`
WHERE `rank` IS NOT NULL AND TRIM(`rank`) <> ''
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `deletedAt` = NULL,
  `updatedAt` = NOW(3);

ALTER TABLE `militaries`
  ADD COLUMN `rankId` INTEGER NULL AFTER `rank`,
  ADD COLUMN `genderId` INTEGER NULL AFTER `gender`;

UPDATE `militaries` m
JOIN `military_rank_catalogs` rc
  ON rc.`codeNormalized` = UPPER(TRIM(m.`rank`))
SET m.`rankId` = rc.`id`
WHERE m.`rankId` IS NULL;

UPDATE `militaries` m
JOIN `military_gender_catalogs` gc
  ON gc.`codeNormalized` = UPPER(TRIM(m.`gender`))
SET m.`genderId` = gc.`id`
WHERE m.`genderId` IS NULL;

CREATE INDEX `militaries_rankId_idx` ON `militaries`(`rankId`);
CREATE INDEX `militaries_genderId_idx` ON `militaries`(`genderId`);

ALTER TABLE `militaries`
  ADD CONSTRAINT `militaries_rankId_fkey`
  FOREIGN KEY (`rankId`) REFERENCES `military_rank_catalogs`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `militaries`
  ADD CONSTRAINT `militaries_genderId_fkey`
  FOREIGN KEY (`genderId`) REFERENCES `military_gender_catalogs`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
