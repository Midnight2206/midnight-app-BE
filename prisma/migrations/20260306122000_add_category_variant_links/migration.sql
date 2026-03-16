CREATE TABLE IF NOT EXISTS `category_versions` (
  `categoryId` INT NOT NULL,
  `versionId` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`categoryId`, `versionId`),
  INDEX `category_versions_versionId_idx`(`versionId`),
  CONSTRAINT `category_versions_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_versions_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `versions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `category_colors` (
  `categoryId` INT NOT NULL,
  `colorId` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`categoryId`, `colorId`),
  INDEX `category_colors_colorId_idx`(`colorId`),
  CONSTRAINT `category_colors_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_colors_colorId_fkey`
    FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `category_versions` (`categoryId`, `versionId`, `createdAt`)
SELECT `id`, `versionId`, NOW(3)
FROM `categories`
WHERE `versionId` IS NOT NULL;

INSERT IGNORE INTO `category_colors` (`categoryId`, `colorId`, `createdAt`)
SELECT `id`, `colorId`, NOW(3)
FROM `categories`
WHERE `colorId` IS NOT NULL;
