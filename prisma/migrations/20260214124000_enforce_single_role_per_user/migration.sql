-- Keep only one role per user (latest assignedAt, then highest roleId)
DELETE ur_old
FROM `UserRole` ur_old
JOIN `UserRole` ur_newer
  ON ur_old.`userId` = ur_newer.`userId`
 AND (
   ur_old.`assignedAt` < ur_newer.`assignedAt`
   OR (ur_old.`assignedAt` = ur_newer.`assignedAt` AND ur_old.`roleId` < ur_newer.`roleId`)
 );

ALTER TABLE `UserRole`
  ADD UNIQUE INDEX `UserRole_userId_key` (`userId`);

CREATE INDEX `UserRole_roleId_idx` ON `UserRole` (`roleId`);
