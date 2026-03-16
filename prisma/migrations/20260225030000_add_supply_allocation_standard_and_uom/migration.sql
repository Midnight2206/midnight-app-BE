CREATE TABLE `unit_of_measures` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `nameNormalized` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `unit_of_measures_nameNormalized_key`(`nameNormalized`),
  INDEX `unit_of_measures_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `unit_of_measures` (`name`, `nameNormalized`, `updatedAt`)
VALUES
  ('Cái', 'cái', NOW(3)),
  ('Bộ', 'bộ', NOW(3)),
  ('Suất', 'suất', NOW(3)),
  ('Đôi', 'đôi', NOW(3)),
  ('Chiếc', 'chiếc', NOW(3));

ALTER TABLE `supply_items`
  ADD COLUMN `unitOfMeasureId` INT NULL;

UPDATE `supply_items`
SET `unitOfMeasureId` = (
  SELECT `id`
  FROM `unit_of_measures`
  WHERE `nameNormalized` = 'cái'
  LIMIT 1
)
WHERE `unitOfMeasureId` IS NULL;

ALTER TABLE `supply_items`
  MODIFY `unitOfMeasureId` INT NOT NULL;

ALTER TABLE `supply_items`
  ADD INDEX `supply_items_unitOfMeasureId_idx`(`unitOfMeasureId`),
  ADD CONSTRAINT `supply_items_unitOfMeasureId_fkey`
    FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unit_of_measures`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `supply_allocation_subjects` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `nameNormalized` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  UNIQUE INDEX `supply_allocation_subjects_nameNormalized_key`(`nameNormalized`),
  INDEX `supply_allocation_subjects_deletedAt_idx`(`deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supply_allocation_standards` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `subjectId` INT NOT NULL,
  `categoryId` INT NOT NULL,
  `serviceLifeYears` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL,
  INDEX `supply_allocation_standards_subjectId_deletedAt_idx`(`subjectId`, `deletedAt`),
  INDEX `supply_allocation_standards_categoryId_deletedAt_idx`(`categoryId`, `deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supply_allocation_standards`
  ADD CONSTRAINT `supply_allocation_standards_subjectId_fkey`
    FOREIGN KEY (`subjectId`) REFERENCES `supply_allocation_subjects`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_standards_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `supply_allocation_standard_items` (
  `standardId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `quantity` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `supply_allocation_standard_items_itemId_idx`(`itemId`),
  PRIMARY KEY (`standardId`, `itemId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supply_allocation_standard_items`
  ADD CONSTRAINT `supply_allocation_standard_items_standardId_fkey`
    FOREIGN KEY (`standardId`) REFERENCES `supply_allocation_standards`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `supply_allocation_standard_items_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `supply_items`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
