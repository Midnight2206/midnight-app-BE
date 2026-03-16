/*
  Warnings:

  - The primary key for the `supply_allocation_issue_voucher_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `supply_allocation_issue_vouchers` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `supply_allocation_standard_item_subject_conditions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the `warehouse_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `warehouse_stocks` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `category_warehouse_stocks` DROP FOREIGN KEY `category_warehouse_stocks_next_variantId_fkey`;

-- DropForeignKey
ALTER TABLE `category_warehouse_stocks` DROP FOREIGN KEY `category_warehouse_stocks_next_warehouseId_fkey`;

-- DropForeignKey
ALTER TABLE `military_transfer_requests` DROP FOREIGN KEY `military_transfer_requests_militaryId_fkey`;

-- DropForeignKey
ALTER TABLE `supply_allocation_issue_logs` DROP FOREIGN KEY `supply_allocation_issue_logs_standard_item_fkey`;

-- DropForeignKey
ALTER TABLE `supply_allocation_issue_logs` DROP FOREIGN KEY `supply_allocation_issue_logs_voucherId_fkey`;

-- DropForeignKey
ALTER TABLE `supply_allocation_issue_voucher_items` DROP FOREIGN KEY `supply_allocation_issue_voucher_items_standardItem_fkey`;

-- DropForeignKey
ALTER TABLE `supply_allocation_issue_voucher_items` DROP FOREIGN KEY `supply_allocation_issue_voucher_items_voucherId_fkey`;

-- DropForeignKey
ALTER TABLE `supply_allocation_standard_item_rules` DROP FOREIGN KEY `supply_allocation_standard_item_rules_standard_item_fkey`;

-- DropForeignKey
ALTER TABLE `warehouse_items` DROP FOREIGN KEY `warehouse_items_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `warehouse_items` DROP FOREIGN KEY `warehouse_items_warehouseId_fkey`;

-- DropForeignKey
ALTER TABLE `warehouse_stocks` DROP FOREIGN KEY `warehouse_stocks_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `warehouse_stocks` DROP FOREIGN KEY `warehouse_stocks_warehouseId_fkey`;

-- DropIndex
DROP INDEX `militaries_gender_idx` ON `militaries`;

-- DropIndex
DROP INDEX `military_transfer_requests_militaryId_pendingFlag_key` ON `military_transfer_requests`;

-- DropIndex
DROP INDEX `military_transfer_requests_militaryId_status_idx` ON `military_transfer_requests`;

-- AlterTable
ALTER TABLE `registration_year_options` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `supply_allocation_issue_logs` MODIFY `voucherId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `supply_allocation_issue_voucher_items` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `voucherId` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `supply_allocation_issue_vouchers` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `voucherNo` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `supply_allocation_standard_campaign_contents` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `supply_allocation_standard_item_rules` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `supply_allocation_standard_item_subject_conditions` DROP PRIMARY KEY,
    MODIFY `mode` VARCHAR(191) NOT NULL,
    ALTER COLUMN `updatedAt` DROP DEFAULT,
    ADD PRIMARY KEY (`standardId`, `itemId`, `subjectId`, `mode`);

-- AlterTable
ALTER TABLE `supply_items` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `warehouses` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- DropTable
DROP TABLE `warehouse_items`;

-- DropTable
DROP TABLE `warehouse_stocks`;

-- CreateIndex
CREATE INDEX `size_registration_requests_periodId_idx` ON `size_registration_requests`(`periodId`);

-- CreateIndex
CREATE INDEX `warehouses_deletedAt_idx` ON `warehouses`(`deletedAt`);

-- AddForeignKey
ALTER TABLE `size_registration_requests` ADD CONSTRAINT `size_registration_requests_militaryId_fkey` FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supply_allocation_standard_item_rules` ADD CONSTRAINT `supply_allocation_standard_item_rules_standardId_itemId_fkey` FOREIGN KEY (`standardId`, `itemId`) REFERENCES `supply_allocation_standard_items`(`standardId`, `itemId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supply_allocation_issue_logs` ADD CONSTRAINT `supply_allocation_issue_logs_standardId_itemId_fkey` FOREIGN KEY (`standardId`, `itemId`) REFERENCES `supply_allocation_standard_items`(`standardId`, `itemId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supply_allocation_issue_logs` ADD CONSTRAINT `supply_allocation_issue_logs_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `supply_allocation_issue_vouchers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supply_allocation_issue_voucher_items` ADD CONSTRAINT `supply_allocation_issue_voucher_items_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `supply_allocation_issue_vouchers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supply_allocation_issue_voucher_items` ADD CONSTRAINT `supply_allocation_issue_voucher_items_standardId_itemId_fkey` FOREIGN KEY (`standardId`, `itemId`) REFERENCES `supply_allocation_standard_items`(`standardId`, `itemId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `category_warehouse_stocks` ADD CONSTRAINT `category_warehouse_stocks_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `category_warehouse_stocks` ADD CONSTRAINT `category_warehouse_stocks_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `category_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `supply_allocation_issue_logs` RENAME INDEX `supply_allocation_issue_logs_military_item_issuedAt_idx` TO `supply_allocation_issue_logs_militaryId_itemId_issuedAt_idx`;

-- RenameIndex
ALTER TABLE `supply_allocation_issue_logs` RENAME INDEX `supply_allocation_issue_logs_standard_issuedAt_idx` TO `supply_allocation_issue_logs_standardId_issuedAt_idx`;
