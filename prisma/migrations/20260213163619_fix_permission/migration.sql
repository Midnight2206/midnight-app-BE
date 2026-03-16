/*
  Warnings:

  - You are about to drop the column `militaryId` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[claimedByUserId]` on the table `militaries` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `fullname` to the `militaries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `initialCommissioningYear` to the `militaries` table without a default value. This is not possible if the table is not empty.
  - Made the column `unitId` on table `militaries` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `militaries` DROP FOREIGN KEY `militaries_unitId_fkey`;

-- DropForeignKey
ALTER TABLE `military_category_sizes` DROP FOREIGN KEY `military_category_sizes_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `military_category_sizes` DROP FOREIGN KEY `military_category_sizes_categoryId_sizeId_fkey`;

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_militaryId_fkey`;

-- DropIndex
DROP INDEX `military_category_sizes_categoryId_sizeId_fkey` ON `military_category_sizes`;

-- DropIndex
DROP INDEX `users_militaryId_key` ON `users`;

-- AlterTable
ALTER TABLE `militaries` ADD COLUMN `assignedUnit` VARCHAR(191) NULL,
    ADD COLUMN `claimedAt` DATETIME(3) NULL,
    ADD COLUMN `claimedByUserId` VARCHAR(191) NULL,
    ADD COLUMN `fullname` VARCHAR(191) NOT NULL,
    ADD COLUMN `importBatchId` VARCHAR(191) NULL,
    ADD COLUMN `initialCommissioningYear` INTEGER NOT NULL,
    MODIFY `unitId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `users` DROP COLUMN `militaryId`;

-- CreateTable
CREATE TABLE `ImportBatch` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `totalRows` INTEGER NOT NULL,
    `validRows` INTEGER NOT NULL,
    `invalidRows` INTEGER NOT NULL,
    `status` ENUM('PREVIEW', 'CONFIRMED', 'FAILED', 'ROLLBACK') NOT NULL,
    `mode` ENUM('STRICT', 'SKIP_DUPLICATE', 'UPDATE') NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportError` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `field` VARCHAR(191) NULL,
    `message` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ImportError_batchId_idx`(`batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `categories_deletedAt_idx` ON `categories`(`deletedAt`);

-- CreateIndex
CREATE UNIQUE INDEX `militaries_claimedByUserId_key` ON `militaries`(`claimedByUserId`);

-- CreateIndex
CREATE INDEX `militaries_importBatchId_idx` ON `militaries`(`importBatchId`);

-- CreateIndex
CREATE INDEX `militaries_claimedByUserId_idx` ON `militaries`(`claimedByUserId`);

-- CreateIndex
CREATE INDEX `militaries_deletedAt_idx` ON `militaries`(`deletedAt`);

-- CreateIndex
CREATE INDEX `sizes_deletedAt_idx` ON `sizes`(`deletedAt`);

-- AddForeignKey
ALTER TABLE `militaries` ADD CONSTRAINT `militaries_claimedByUserId_fkey` FOREIGN KEY (`claimedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `militaries` ADD CONSTRAINT `militaries_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `ImportBatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `militaries` ADD CONSTRAINT `militaries_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_category_sizes` ADD CONSTRAINT `military_category_sizes_categoryId_sizeId_fkey` FOREIGN KEY (`categoryId`, `sizeId`) REFERENCES `category_sizes`(`categoryId`, `sizeId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportBatch` ADD CONSTRAINT `ImportBatch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImportError` ADD CONSTRAINT `ImportError_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ImportBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
