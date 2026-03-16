-- DropIndex
DROP INDEX `military_category_sizes_categoryId_idx` ON `military_category_sizes`;

-- AddForeignKey
ALTER TABLE `military_category_sizes` ADD CONSTRAINT `military_category_sizes_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
