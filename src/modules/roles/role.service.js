import { prisma } from "#configs/prisma.config.js";
import { AppError } from "#utils/AppError.js";

class RoleService {
  /* ================= CREATE ROLE ================= */

  createRole = async ({ name, description }) => {
    const existing = await prisma.role.findUnique({
      where: { name },
    });

    if (existing) {
      throw new AppError({
        message: "Role already exists",
        statusCode: 400,
      });
    }

    return prisma.role.create({
      data: {
        name,
        description,
      },
    });
  };

  /* ================= UPDATE ROLE ================= */

  updateRole = async (roleId, data) => {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role || role.deletedAt) {
      throw new AppError({
        message: "Role not found",
        statusCode: 404,
      });
    }

    return prisma.role.update({
      where: { id: roleId },
      data,
    });
  };

  /* ================= DELETE ROLE (SOFT) ================= */

  deleteRole = async (roleId) => {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role || role.deletedAt) {
      throw new AppError({
        message: "Role not found",
        statusCode: 404,
      });
    }

    return prisma.role.update({
      where: { id: roleId },
      data: {
        deletedAt: new Date(),
      },
    });
  };

  /* ================= ASSIGN PERMISSION TO ROLE ================= */

  assignPermission = async (roleId, permissionCode) => {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role || role.deletedAt) {
      throw new AppError({
        message: "Role not found",
        statusCode: 404,
      });
    }

    const permission = await prisma.permission.findUnique({
      where: { code: permissionCode },
    });

    if (!permission) {
      throw new AppError({
        message: "Permission not found",
        statusCode: 404,
      });
    }

    return prisma.rolePermission.create({
      data: {
        roleId,
        permissionId: permission.id,
      },
    });
  };

  /* ================= REMOVE PERMISSION FROM ROLE ================= */

  removePermission = async (roleId, permissionCode) => {
    const permission = await prisma.permission.findUnique({
      where: { code: permissionCode },
    });

    if (!permission) {
      throw new AppError({
        message: "Permission not found",
        statusCode: 404,
      });
    }

    return prisma.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId: permission.id,
        },
      },
    });
  };

  /* ================= ASSIGN ROLE TO USER ================= */

  assignRoleToUser = async (userId, roleId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deletedAt) {
      throw new AppError({
        message: "User not found",
        statusCode: 404,
      });
    }

    const role = await prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role || role.deletedAt) {
      throw new AppError({
        message: "Role not found",
        statusCode: 404,
      });
    }

    if (role.name === "USER") {
      const claimedMilitary = await prisma.military.findFirst({
        where: {
          claimedByUserId: userId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!claimedMilitary) {
        throw new AppError({
          message: "USER role requires claimed military profile",
          statusCode: 400,
        });
      }
    }

    return prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId,
        },
      });

      return tx.userRole.create({
        data: {
          userId,
          roleId,
        },
      });
    });
  };

  /* ================= REMOVE ROLE FROM USER ================= */

  removeRoleFromUser = async (userId, roleId) => {
    return prisma.userRole.deleteMany({
      where: {
        userId,
        roleId,
      },
    });
  };

  /* ================= GET ROLE DETAIL ================= */

  getRoleDetail = async (roleId) => {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        users: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!role || role.deletedAt) {
      throw new AppError({
        message: "Role not found",
        statusCode: 404,
      });
    }

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions.map((p) => p.permission.code),
      users: role.users.map((u) => ({
        id: u.user.id,
        email: u.user.email,
      })),
    };
  };
}

export default new RoleService();
