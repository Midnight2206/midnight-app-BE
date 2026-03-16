import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { ensureSuperAdmin } from "#utils/roleGuards.js";
import { syncPermissionsFromRoutes } from "#services/permission-sync.service.js";

function assertSuperAdmin(actor) {
  ensureSuperAdmin(actor, "Only SUPER_ADMIN can manage access control");
}

class AccessService {
  listRoles = async ({ actor }) => {
    assertSuperAdmin(actor);

    const roles = await prisma.role.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        permissions: {
          include: {
            permission: {
              select: {
                id: true,
                code: true,
                description: true,
              },
            },
          },
        },
        users: {
          select: {
            userId: true,
          },
        },
      },
      orderBy: {
        id: "asc",
      },
    });

    return {
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        userCount: role.users.length,
        permissions: role.permissions.map((rp) => rp.permission),
      })),
    };
  };

  listPermissions = async ({ actor }) => {
    assertSuperAdmin(actor);

    const permissions = await prisma.permission.findMany({
      orderBy: {
        code: "asc",
      },
      select: {
        id: true,
        code: true,
        description: true,
      },
    });

    return { permissions };
  };

  syncPermissions = async ({ actor }) => {
    assertSuperAdmin(actor);
    return syncPermissionsFromRoutes();
  };

  listUsers = async ({ actor }) => {
    assertSuperAdmin(actor);

    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        military: {
          select: {
            id: true,
            fullname: true,
            militaryCode: true,
            rank: true,
            position: true,
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        roles: {
          where: {
            role: {
              deletedAt: null,
            },
          },
          orderBy: {
            assignedAt: "desc",
          },
          include: {
            role: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return {
      users: users.map((user) => {
        const assignedRole = user.roles[0]?.role || null;

        return {
          id: user.id,
          email: user.email,
          username: user.username,
          isActive: user.isActive,
          unit: user.unit,
          military: user.military,
          role: assignedRole,
          roles: assignedRole ? [assignedRole] : [],
        };
      }),
    };
  };

  createRole = async ({ actor, body }) => {
    assertSuperAdmin(actor);

    const name = body.name.trim();
    const description = body.description?.trim() || null;

    const existed = await prisma.role.findFirst({
      where: {
        name,
      },
    });

    if (existed && !existed.deletedAt) {
      throw new AppError({
        message: "Role already exists",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "ROLE_EXISTS",
      });
    }

    const role = existed
      ? await prisma.role.update({
          where: {
            id: existed.id,
          },
          data: {
            name,
            description,
            deletedAt: null,
          },
        })
      : await prisma.role.create({
          data: {
            name,
            description,
          },
        });

    return {
      id: role.id,
      name: role.name,
      description: role.description,
    };
  };

  updateRolePermissions = async ({ actor, roleId, permissionCodes }) => {
    assertSuperAdmin(actor);

    const role = await prisma.role.findFirst({
      where: {
        id: roleId,
        deletedAt: null,
      },
    });

    if (!role) {
      throw new AppError({
        message: "Role not found",
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "ROLE_NOT_FOUND",
      });
    }

    const codes = [...new Set(permissionCodes.map((code) => code.trim()))].filter(
      Boolean,
    );

    const permissions = await prisma.permission.findMany({
      where: {
        code: {
          in: codes,
        },
      },
      select: {
        id: true,
        code: true,
      },
    });

    if (permissions.length !== codes.length) {
      const foundCodes = new Set(permissions.map((p) => p.code));
      const missing = codes.filter((code) => !foundCodes.has(code));

      throw new AppError({
        message: `Permission not found: ${missing.join(", ")}`,
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "PERMISSION_NOT_FOUND",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: {
          roleId,
        },
      });

      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId,
            permissionId: permission.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    return {
      roleId,
      permissionCodes: codes,
    };
  };

  updateUserRole = async ({ actor, userId, roleName }) => {
    assertSuperAdmin(actor);

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      include: {
        roles: {
          include: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new AppError({
        message: "User not found",
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "USER_NOT_FOUND",
      });
    }

    const currentRoleNames = user.roles.map((ur) => ur.role.name);
    if (currentRoleNames.includes("SUPER_ADMIN")) {
      throw new AppError({
        message: "Cannot modify SUPER_ADMIN roles",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "SUPER_ADMIN_PROTECTED",
      });
    }

    const normalizedRoleName = String(roleName || "").trim();
    if (!normalizedRoleName) {
      throw new AppError({
        message: "Role is required",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "ROLE_REQUIRED",
      });
    }

    if (normalizedRoleName === "SUPER_ADMIN") {
      throw new AppError({
        message: "Cannot assign SUPER_ADMIN role from this feature",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "SUPER_ADMIN_PROTECTED",
      });
    }

    const role = await prisma.role.findFirst({
      where: {
        name: normalizedRoleName,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!role) {
      throw new AppError({
        message: `Role not found: ${normalizedRoleName}`,
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "ROLE_NOT_FOUND",
      });
    }

    if (normalizedRoleName === "USER") {
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
          statusCode: HTTP_CODES.BAD_REQUEST,
          errorCode: "CLAIM_REQUIRED_FOR_USER_ROLE",
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: {
          userId,
        },
      });

      await tx.userRole.create({
        data: {
          userId,
          roleId: role.id,
        },
      });
    });

    return {
      userId,
      roleName: normalizedRoleName,
    };
  };
}

export default new AccessService();
