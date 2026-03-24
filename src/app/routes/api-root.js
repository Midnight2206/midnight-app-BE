import { Router } from "express";
import authRoute from "#src/modules/auth/auth.route.js";
import accessRoute from "#src/modules/access/access.route.js";
import accountsRoute from "#src/modules/accounts/accounts.route.js";
import allocationModesRoute from "#src/modules/allocation-modes/allocation-modes.route.js";
import inventoriesRoute from "#src/modules/inventory/inventories.route.js";
import militariesRoute from "#src/modules/militaries/militaries.route.js";
import backupsRoute from "#src/modules/backups/backups.route.js";
import categoriesRoute from "#src/modules/categories/categories.route.js";
import roleRoute from "#src/modules/roles/role.route.js";
import sizeRegistrationsRoute from "#src/modules/size-registrations/size-registrations.route.js";

const router = Router();

router.use("/auth", authRoute);
router.use("/access", accessRoute);
router.use("/accounts", accountsRoute);
router.use("/allocation-modes", allocationModesRoute);
router.use("/inventories", inventoriesRoute);
router.use("/militaries", militariesRoute);
router.use("/backups", backupsRoute);
router.use("/categories", categoriesRoute);
router.use("/role", roleRoute);
router.use("/size-registrations", sizeRegistrationsRoute);

export default router;
