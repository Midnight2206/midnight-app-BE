CREATE TABLE IF NOT EXISTS `category_variants` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `categoryId` INT NOT NULL,
  `versionId` INT NOT NULL,
  `colorId` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `category_variants_categoryId_versionId_colorId_key`(`categoryId`, `versionId`, `colorId`),
  INDEX `category_variants_categoryId_idx`(`categoryId`),
  INDEX `category_variants_versionId_idx`(`versionId`),
  INDEX `category_variants_colorId_idx`(`colorId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `category_variants`
  ADD CONSTRAINT `category_variants_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `category_variants_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `versions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `category_variants_colorId_fkey`
    FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `category_variants` (`categoryId`, `versionId`, `colorId`, `createdAt`, `updatedAt`)
SELECT
  cv.`categoryId`,
  cv.`versionId`,
  cc.`colorId`,
  NOW(3),
  NOW(3)
FROM `category_versions` cv
JOIN `category_colors` cc
  ON cc.`categoryId` = cv.`categoryId`;

INSERT IGNORE INTO `category_variants` (`categoryId`, `versionId`, `colorId`, `createdAt`, `updatedAt`)
SELECT
  `categoryId`,
  `versionId`,
  `colorId`,
  NOW(3),
  NOW(3)
FROM `category_warehouse_items`;

INSERT IGNORE INTO `category_variants` (`categoryId`, `versionId`, `colorId`, `createdAt`, `updatedAt`)
SELECT
  `categoryId`,
  `versionId`,
  `colorId`,
  NOW(3),
  NOW(3)
FROM `category_warehouse_stocks`;

ALTER TABLE `category_warehouse_items`
  ADD CONSTRAINT `category_warehouse_items_category_variant_fkey`
    FOREIGN KEY (`categoryId`, `versionId`, `colorId`)
    REFERENCES `category_variants`(`categoryId`, `versionId`, `colorId`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `category_warehouse_stocks`
  ADD CONSTRAINT `category_warehouse_stocks_category_variant_fkey`
    FOREIGN KEY (`categoryId`, `versionId`, `colorId`)
    REFERENCES `category_variants`(`categoryId`, `versionId`, `colorId`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
