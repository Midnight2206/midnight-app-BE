CREATE TABLE `supply_allocation_standard_item_rules` (
  `standardId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `gender` ENUM('ANY', 'MALE', 'FEMALE') NOT NULL DEFAULT 'ANY',
  `rankGroup` ENUM('ANY', 'CAP_UY', 'CAP_TA', 'CAP_TUONG', 'OTHER') NOT NULL DEFAULT 'ANY',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`standardId`, `itemId`),
  INDEX `supply_allocation_standard_item_rules_itemId_idx`(`itemId`),

  CONSTRAINT `supply_allocation_standard_item_rules_standard_item_fkey`
    FOREIGN KEY (`standardId`, `itemId`) REFERENCES `supply_allocation_standard_items`(`standardId`, `itemId`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supply_allocation_issue_logs` (
  `id` VARCHAR(191) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `standardId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `quantity` INT NOT NULL,
  `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NULL,
  `note` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `supply_allocation_issue_logs_military_item_issuedAt_idx`(`militaryId`, `itemId`, `issuedAt`),
  INDEX `supply_allocation_issue_logs_standard_issuedAt_idx`(`standardId`, `issuedAt`),
  INDEX `supply_allocation_issue_logs_createdById_idx`(`createdById`),

  CONSTRAINT `supply_allocation_issue_logs_militaryId_fkey`
    FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `supply_allocation_issue_logs_standard_item_fkey`
    FOREIGN KEY (`standardId`, `itemId`) REFERENCES `supply_allocation_standard_items`(`standardId`, `itemId`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `supply_allocation_issue_logs_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
