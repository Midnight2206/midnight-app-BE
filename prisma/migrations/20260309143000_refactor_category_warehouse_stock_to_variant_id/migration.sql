CREATE TABLE `category_warehouse_stocks_next` (
  `warehouseId` INT NOT NULL,
  `variantId` INT NOT NULL,
  `quantity` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`warehouseId`, `variantId`),
  INDEX `category_warehouse_stocks_variantId_idx`(`variantId`),

  CONSTRAINT `category_warehouse_stocks_next_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_warehouse_stocks_next_variantId_fkey`
    FOREIGN KEY (`variantId`) REFERENCES `category_variants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `category_warehouse_stocks_next` (
  `warehouseId`,
  `variantId`,
  `quantity`,
  `createdAt`,
  `updatedAt`
)
SELECT
  cws.`warehouseId`,
  cv.`id` AS `variantId`,
  cws.`quantity`,
  cws.`createdAt`,
  cws.`updatedAt`
FROM `category_warehouse_stocks` cws
JOIN `category_variants` cv
  ON cv.`categoryId` = cws.`categoryId`
  AND cv.`versionId` = cws.`versionId`
  AND cv.`colorId` = cws.`colorId`;

DROP TABLE `category_warehouse_stocks`;
RENAME TABLE `category_warehouse_stocks_next` TO `category_warehouse_stocks`;
