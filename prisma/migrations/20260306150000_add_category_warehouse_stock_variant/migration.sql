CREATE TABLE IF NOT EXISTS `category_warehouse_items` (
  `warehouseId` INT NOT NULL,
  `categoryId` INT NOT NULL,
  `versionId` INT NOT NULL,
  `colorId` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`warehouseId`, `categoryId`, `versionId`, `colorId`),
  INDEX `category_warehouse_items_categoryId_idx`(`categoryId`),
  INDEX `category_warehouse_items_versionId_idx`(`versionId`),
  INDEX `category_warehouse_items_colorId_idx`(`colorId`),
  CONSTRAINT `category_warehouse_items_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_warehouse_items_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_warehouse_items_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `versions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `category_warehouse_items_colorId_fkey`
    FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `category_warehouse_stocks` (
  `warehouseId` INT NOT NULL,
  `categoryId` INT NOT NULL,
  `versionId` INT NOT NULL,
  `colorId` INT NOT NULL,
  `quantity` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`warehouseId`, `categoryId`, `versionId`, `colorId`),
  INDEX `category_warehouse_stocks_categoryId_idx`(`categoryId`),
  INDEX `category_warehouse_stocks_versionId_idx`(`versionId`),
  INDEX `category_warehouse_stocks_colorId_idx`(`colorId`),
  CONSTRAINT `category_warehouse_stocks_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_warehouse_stocks_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `category_warehouse_stocks_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `versions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `category_warehouse_stocks_colorId_fkey`
    FOREIGN KEY (`colorId`) REFERENCES `colors`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
