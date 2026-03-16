CREATE TABLE `military_type_catalogs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(191) NOT NULL,
  `codeNormalized` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,

  UNIQUE INDEX `military_type_catalogs_codeNormalized_key`(`codeNormalized`),
  INDEX `military_type_catalogs_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `military_type_assignments` (
  `militaryId` VARCHAR(191) NOT NULL,
  `typeId` INTEGER NOT NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `military_type_assignments_typeId_idx`(`typeId`),
  INDEX `military_type_assignments_militaryId_idx`(`militaryId`),
  PRIMARY KEY (`militaryId`, `typeId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `military_type_assignments`
  ADD CONSTRAINT `military_type_assignments_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `military_type_assignments`
  ADD CONSTRAINT `military_type_assignments_typeId_fkey`
  FOREIGN KEY (`typeId`) REFERENCES `military_type_catalogs`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `military_type_catalogs` (`code`, `codeNormalized`, `name`, `createdAt`, `updatedAt`)
VALUES
  ('SQ', 'SQ', 'Sĩ quan', NOW(3), NOW(3)),
  ('QNCN', 'QNCN', 'Quân nhân chuyên nghiệp', NOW(3), NOW(3)),
  ('HSQ-CS', 'HSQ-CS', 'Hạ sĩ quan - chiến sĩ', NOW(3), NOW(3));

INSERT INTO `military_type_assignments` (`militaryId`, `typeId`, `assignedAt`)
SELECT m.`id`, c.`id`, NOW(3)
FROM `militaries` m
JOIN `military_type_catalogs` c ON c.`codeNormalized` = UPPER(REPLACE(m.`type`, '_', '-'))
WHERE m.`deletedAt` IS NULL;

DROP INDEX `militaries_type_idx` ON `militaries`;
ALTER TABLE `militaries` DROP COLUMN `type`;
