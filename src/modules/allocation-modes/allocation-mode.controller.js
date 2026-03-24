import allocationModeService from "./allocation-mode.service.js";
import { HTTP_CODES } from "#src/constants.js";

class AllocationModeController {
  listModes = async (req, res) => {
    const result = await allocationModeService.listModes({
      actor: req.user,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get allocation modes successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createMode = async (req, res) => {
    const result = await allocationModeService.createMode({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create allocation mode successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  updateMode = async (req, res) => {
    const result = await allocationModeService.updateMode({
      actor: req.user,
      modeId: req.params.modeId,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Update allocation mode successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  deleteMode = async (req, res) => {
    const result = await allocationModeService.deleteMode({
      actor: req.user,
      modeId: req.params.modeId,
    });

    return res.success({
      data: result,
      message: "Delete allocation mode successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listApplicableModes = async (req, res) => {
    const result = await allocationModeService.listApplicableModes({
      actor: req.user,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get applicable allocation modes successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getModeEligibility = async (req, res) => {
    const result = await allocationModeService.getModeEligibility({
      actor: req.user,
      modeId: req.params.modeId,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get allocation mode eligibility successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createIssueVoucher = async (req, res) => {
    const result = await allocationModeService.createIssueVoucher({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create allocation mode issue voucher successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  listIssueVouchers = async (req, res) => {
    const result = await allocationModeService.listIssueVouchers({
      actor: req.user,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get allocation mode issue vouchers successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getIssueVoucherById = async (req, res) => {
    const result = await allocationModeService.getIssueVoucherById({
      actor: req.user,
      voucherId: req.params.voucherId,
    });

    return res.success({
      data: result,
      message: "Get allocation mode issue voucher successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  updateIssueVoucher = async (req, res) => {
    const result = await allocationModeService.updateIssueVoucher({
      actor: req.user,
      voucherId: req.params.voucherId,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Update allocation mode issue voucher successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  deleteIssueVoucher = async (req, res) => {
    const result = await allocationModeService.deleteIssueVoucher({
      actor: req.user,
      voucherId: req.params.voucherId,
    });

    return res.success({
      data: result,
      message: "Delete allocation mode issue voucher successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  downloadIssueVoucherFile = async (req, res) => {
    const result = await allocationModeService.getIssueVoucherFile({
      actor: req.user,
      voucherId: req.params.voucherId,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`,
    );

    return res.status(HTTP_CODES.OK).send(result.buffer);
  };

  downloadVoucherTemplate = async (req, res) => {
    const result = await allocationModeService.getVoucherTemplate({
      actor: req.user,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get allocation mode voucher template successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  uploadVoucherTemplate = async (req, res) => {
    const result = await allocationModeService.updateVoucherTemplate({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Update allocation mode voucher template successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}

export default new AllocationModeController();
