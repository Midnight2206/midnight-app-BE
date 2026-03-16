import roleService from "#services/role.service.js";

class RoleController {
  /* ================= CREATE ROLE ================= */

  createRole = async (req, res, next) => {
    try {
      const role = await roleService.createRole(req.body);
      res.status(201).json(role);
    } catch (err) {
      next(err);
    }
  };

  /* ================= UPDATE ROLE ================= */

  updateRole = async (req, res, next) => {
    try {
      const role = await roleService.updateRole(
        Number(req.params.id),
        req.body,
      );
      res.json(role);
    } catch (err) {
      next(err);
    }
  };

  /* ================= DELETE ROLE ================= */

  deleteRole = async (req, res, next) => {
    try {
      await roleService.deleteRole(Number(req.params.id));
      res.json({ message: "Role deleted" });
    } catch (err) {
      next(err);
    }
  };

  /* ================= ASSIGN PERMISSION ================= */

  assignPermission = async (req, res, next) => {
    try {
      const { permissionCode } = req.body;

      const result = await roleService.assignPermission(
        Number(req.params.id),
        permissionCode,
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  /* ================= REMOVE PERMISSION ================= */

  removePermission = async (req, res, next) => {
    try {
      const { permissionCode } = req.body;

      await roleService.removePermission(Number(req.params.id), permissionCode);

      res.json({ message: "Permission removed" });
    } catch (err) {
      next(err);
    }
  };

  /* ================= ASSIGN ROLE TO USER ================= */

  assignRoleToUser = async (req, res, next) => {
    try {
      const { userId } = req.body;

      const result = await roleService.assignRoleToUser(
        userId,
        Number(req.params.id),
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  /* ================= REMOVE ROLE FROM USER ================= */

  removeRoleFromUser = async (req, res, next) => {
    try {
      const { userId } = req.body;

      await roleService.removeRoleFromUser(userId, Number(req.params.id));

      res.json({ message: "Role removed from user" });
    } catch (err) {
      next(err);
    }
  };

  /* ================= GET ROLE DETAIL ================= */

  getRoleDetail = async (req, res, next) => {
    try {
      const role = await roleService.getRoleDetail(Number(req.params.id));

      res.json(role);
    } catch (err) {
      next(err);
    }
  };
}

export default new RoleController();
