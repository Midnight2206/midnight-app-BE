import accountsService from "#services/accounts.service.js";
import { HTTP_CODES } from "#src/constants.js";

class AccountsController {
  listAccounts = async (req, res) => {
    const result = await accountsService.listAccounts({
      actor: req.user,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get accounts successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listUnits = async (req, res) => {
    const result = await accountsService.listUnits({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get units successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listAudits = async (req, res) => {
    const result = await accountsService.listAudits({
      actor: req.user,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get account audit logs successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createAdmin = async (req, res) => {
    const result = await accountsService.createAdminAccount({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create admin account successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  updateAccountStatus = async (req, res) => {
    const result = await accountsService.updateAccountStatus({
      actor: req.user,
      userId: req.params.userId,
      isActive: req.body.isActive,
    });

    return res.success({
      data: result,
      message: "Update account status successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  resetPassword = async (req, res) => {
    const result = await accountsService.resetPassword({
      actor: req.user,
      userId: req.params.userId,
      newPassword: req.body.newPassword,
    });

    return res.success({
      data: result,
      message: "Reset password successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}

export default new AccountsController();
