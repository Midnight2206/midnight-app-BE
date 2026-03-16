/*
  Warnings:

  - You are about to drop the column `deletedAt` on the `category_sizes` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[nameNormalized]` on the table `categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[nameNormalized]` on the table `units` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `nameNormalized` to the `categories` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nameNormalized` to the `units` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `categories` ADD COLUMN `nameNormalized` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `category_sizes` DROP COLUMN `deletedAt`;

-- AlterTable
ALTER TABLE `units` ADD COLUMN `nameNormalized` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `categories_nameNormalized_key` ON `categories`(`nameNormalized`);

-- CreateIndex
CREATE UNIQUE INDEX `units_nameNormalized_key` ON `units`(`nameNormalized`);
