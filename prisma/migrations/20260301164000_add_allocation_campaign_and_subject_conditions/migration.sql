CREATE TABLE IF NOT EXISTS `supply_allocation_standard_campaign_contents` (
  `standardId` INT NOT NULL,
  `content` TEXT NOT NULL,
  `conditionField` VARCHAR(64) NULL,
  `conditionOperator` VARCHAR(16) NULL,
  `conditionIssueYearOffset` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`standardId`),
  CONSTRAINT `supply_allocation_standard_campaign_contents_standardId_fkey`
    FOREIGN KEY (`standardId`) REFERENCES `supply_allocation_standards`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `supply_allocation_standard_item_subject_conditions` (
  `standardId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `subjectId` INT NOT NULL,
  `mode` VARCHAR(16) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`standardId`, `itemId`, `subjectId`, `mode`),
  INDEX `sasisc_subject_idx` (`subjectId`),
  CONSTRAINT `sasisc_std_item_fk`
    FOREIGN KEY (`standardId`, `itemId`) REFERENCES `supply_allocation_standard_items`(`standardId`, `itemId`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `sasisc_subject_fk`
    FOREIGN KEY (`subjectId`) REFERENCES `supply_allocation_subjects`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
