import { Router } from "express";
import allocationModeController from "./allocation-mode.controller.js";
import {
  allocationModeEligibilitySchema,
  allocationModeIdParamSchema,
  allocationModeIssueVoucherIdParamSchema,
  createAllocationModeIssueVoucherSchema,
  createAllocationModeSchema,
  getAllocationModeVoucherTemplateSchema,
  listAllocationModeIssueVouchersSchema,
  listApplicableAllocationModesSchema,
  updateAllocationModeIssueVoucherSchema,
  listAllocationModesSchema,
  updateAllocationModeVoucherTemplateSchema,
  updateAllocationModeSchema,
} from "./allocation-mode.schema.js";
import { validate } from "#middlewares/validateRequest.js";
import { wrapRouter } from "#utils/wrapRouter.js";
import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";

const router = wrapRouter(Router());

router.use(protectedRoute, requirePermission());

router.get(
  "/applicable",
  validate(listApplicableAllocationModesSchema),
  allocationModeController.listApplicableModes,
);

router.get(
  "/voucher-template",
  validate(getAllocationModeVoucherTemplateSchema),
  allocationModeController.downloadVoucherTemplate,
);

router.put(
  "/voucher-template",
  validate(updateAllocationModeVoucherTemplateSchema),
  allocationModeController.uploadVoucherTemplate,
);

router.get(
  "/issue-vouchers",
  validate(listAllocationModeIssueVouchersSchema),
  allocationModeController.listIssueVouchers,
);

router.post(
  "/issue-vouchers",
  validate(createAllocationModeIssueVoucherSchema),
  allocationModeController.createIssueVoucher,
);

router.get(
  "/issue-vouchers/:voucherId",
  validate(allocationModeIssueVoucherIdParamSchema),
  allocationModeController.getIssueVoucherById,
);

router.patch(
  "/issue-vouchers/:voucherId",
  validate(updateAllocationModeIssueVoucherSchema),
  allocationModeController.updateIssueVoucher,
);

router.delete(
  "/issue-vouchers/:voucherId",
  validate(allocationModeIssueVoucherIdParamSchema),
  allocationModeController.deleteIssueVoucher,
);

router.get(
  "/issue-vouchers/:voucherId/file",
  validate(allocationModeIssueVoucherIdParamSchema),
  allocationModeController.downloadIssueVoucherFile,
);

router.get(
  "/:modeId/eligibility",
  validate(allocationModeEligibilitySchema),
  allocationModeController.getModeEligibility,
);

router.get(
  "/",
  validate(listAllocationModesSchema),
  allocationModeController.listModes,
);

router.post(
  "/",
  validate(createAllocationModeSchema),
  allocationModeController.createMode,
);

router.patch(
  "/:modeId",
  validate(updateAllocationModeSchema),
  allocationModeController.updateMode,
);

router.delete(
  "/:modeId",
  validate(allocationModeIdParamSchema),
  allocationModeController.deleteMode,
);

export default router;
