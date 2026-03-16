import { prisma } from "#configs/prisma.config.js";

export async function getCurrentUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) return null;

  const permissions = user.roles.flatMap((r) =>
    r.role.permissions.map((p) => p.permission.code),
  );

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    unitId: user.unitId,
    verifiedAt: user.verifiedAt,
    permissions: [...new Set(permissions)],
    roles: user.roles.map((r) => r.role.name),
    profile: user.profile,
  };
}
