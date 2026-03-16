import accessService from "#services/access.service.js";
import { HTTP_CODES } from "#src/constants.js";

class AccessController {
  listRoles = async (req, res) => {
    const result = await accessService.listRoles({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get roles successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listPermissions = async (req, res) => {
    const result = await accessService.listPermissions({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get permissions successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  syncPermissions = async (req, res) => {
    const result = await accessService.syncPermissions({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Sync permissions successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listUsers = async (req, res) => {
    const result = await accessService.listUsers({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get users successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createRole = async (req, res) => {
    const result = await accessService.createRole({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create role successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  updateRolePermissions = async (req, res) => {
    const result = await accessService.updateRolePermissions({
      actor: req.user,
      roleId: Number(req.params.roleId),
      permissionCodes: req.body.permissionCodes,
    });

    return res.success({
      data: result,
      message: "Update role permissions successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  updateUserRole = async (req, res) => {
    const roleName = req.body.roleName || req.body.roleNames?.[0];

    const result = await accessService.updateUserRole({
      actor: req.user,
      userId: req.params.userId,
      roleName,
    });

    return res.success({
      data: result,
      message: "Update user role successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}

export default new AccessController();
