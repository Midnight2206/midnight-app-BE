/*
  Warnings:

  - You are about to alter the column `searchNormalized` on the `militaries` table. The data in that column could be lost. The data in that column will be cast from `VarChar(1024)` to `VarChar(191)`.

*/
-- DropIndex
DROP INDEX `militaries_searchNormalized_idx` ON `militaries`;

-- AlterTable
ALTER TABLE `militaries` MODIFY `searchNormalized` VARCHAR(191) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE `size_registration_periods` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `status` ENUM('OPEN', 'LOCKED') NOT NULL DEFAULT 'LOCKED',
    `openedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `note` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `size_registration_periods_year_key`(`year`),
    INDEX `size_registration_periods_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `size_registration_requests` (
    `id` VARCHAR(191) NOT NULL,
    `periodId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `militaryId` VARCHAR(191) NOT NULL,
    `submittedByUserId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `submitNote` VARCHAR(191) NULL,
    `reviewNote` VARCHAR(191) NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `size_registration_requests_year_status_idx`(`year`, `status`),
    INDEX `size_registration_requests_militaryId_year_idx`(`militaryId`, `year`),
    INDEX `size_registration_requests_submittedByUserId_idx`(`submittedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `size_registration_request_items` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `sizeId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `size_registration_request_items_requestId_idx`(`requestId`),
    UNIQUE INDEX `size_registration_request_items_requestId_categoryId_key`(`requestId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `military_category_size_yearly` (
    `id` VARCHAR(191) NOT NULL,
    `periodId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `militaryId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `sizeId` INTEGER NOT NULL,
    `source` ENUM('IMPORT', 'MANUAL_ADMIN', 'APPROVED_REQUEST') NOT NULL DEFAULT 'APPROVED_REQUEST',
    `requestId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `military_category_size_yearly_periodId_militaryId_idx`(`periodId`, `militaryId`),
    INDEX `military_category_size_yearly_requestId_idx`(`requestId`),
    UNIQUE INDEX `military_category_size_yearly_year_militaryId_categoryId_key`(`year`, `militaryId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `militaries_searchNormalized_idx` ON `militaries`(`searchNormalized`);

-- AddForeignKey
ALTER TABLE `size_registration_periods` ADD CONSTRAINT `size_registration_periods_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_periods` ADD CONSTRAINT `size_registration_periods_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_requests` ADD CONSTRAINT `size_registration_requests_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `size_registration_periods`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_requests` ADD CONSTRAINT `size_registration_requests_militaryId_fkey` FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_requests` ADD CONSTRAINT `size_registration_requests_submittedByUserId_fkey` FOREIGN KEY (`submittedByUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_requests` ADD CONSTRAINT `size_registration_requests_reviewedByUserId_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_request_items` ADD CONSTRAINT `size_registration_request_items_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `size_registration_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_request_items` ADD CONSTRAINT `size_registration_request_items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_request_items` ADD CONSTRAINT `size_registration_request_items_sizeId_fkey` FOREIGN KEY (`sizeId`) REFERENCES `sizes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `size_registration_request_items` ADD CONSTRAINT `size_registration_request_items_categoryId_sizeId_fkey` FOREIGN KEY (`categoryId`, `sizeId`) REFERENCES `category_sizes`(`categoryId`, `sizeId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_category_size_yearly` ADD CONSTRAINT `military_category_size_yearly_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `size_registration_periods`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_category_size_yearly` ADD CONSTRAINT `military_category_size_yearly_militaryId_fkey` FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_category_size_yearly` ADD CONSTRAINT `military_category_size_yearly_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_category_size_yearly` ADD CONSTRAINT `military_category_size_yearly_sizeId_fkey` FOREIGN KEY (`sizeId`) REFERENCES `sizes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_category_size_yearly` ADD CONSTRAINT `military_category_size_yearly_categoryId_sizeId_fkey` FOREIGN KEY (`categoryId`, `sizeId`) REFERENCES `category_sizes`(`categoryId`, `sizeId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `military_category_size_yearly` ADD CONSTRAINT `military_category_size_yearly_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `size_registration_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
