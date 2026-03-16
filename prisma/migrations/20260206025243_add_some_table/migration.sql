/*
  Warnings:

  - A unique constraint covering the columns `[militaryId]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `initialCommissioningYear` to the `profiles` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `profiles` ADD COLUMN `assignedUnit` VARCHAR(191) NULL,
    ADD COLUMN `initialCommissioningYear` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `militaryId` VARCHAR(191) NULL,
    MODIFY `role` ENUM('USER', 'ADMIN', 'SUPPER_ADMIN') NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE `militaries` (
    `id` VARCHAR(191) NOT NULL,
    `rank` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `position` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `users_militaryId_key` ON `users`(`militaryId`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_militaryId_fkey` FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
