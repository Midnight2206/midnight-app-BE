/*
  Warnings:

  - You are about to drop the column `unit` on the `militaries` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Role` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `militaries` DROP COLUMN `unit`,
    ADD COLUMN `unitId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Permission_code_idx` ON `Permission`(`code`);

-- CreateIndex
CREATE INDEX `Role_deletedAt_idx` ON `Role`(`deletedAt`);

-- CreateIndex
CREATE INDEX `militaries_unitId_idx` ON `militaries`(`unitId`);

-- CreateIndex
CREATE INDEX `users_deletedAt_idx` ON `users`(`deletedAt`);

-- AddForeignKey
ALTER TABLE `militaries` ADD CONSTRAINT `militaries_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
