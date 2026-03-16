import { prisma } from "#configs/prisma.config.js";
import { assertSuperAdmin, parsePositiveInteger } from "#services/accounts/common.js";

function resolveClaimStatus(query) {
  const claimStatusRaw = (query.claimStatus || "").trim().toLowerCase();
  const claimedRaw = (query.claimed || "").trim().toLowerCase();

  if (claimStatusRaw === "claimed" || claimStatusRaw === "unclaimed") {
    return claimStatusRaw;
  }
  if (claimedRaw === "true") return "claimed";
  if (claimedRaw === "false") return "unclaimed";
  return "all";
}

function buildListAccountsWhere(query) {
  const search = (query.search || "").trim();
  const role = (query.role || "").trim();
  const unitId = query.unitId ? Number(query.unitId) : null;
  const isActiveRaw = query.isActive;
  const claimStatus = resolveClaimStatus(query);

  return {
    deletedAt: null,
    ...(search
      ? {
          OR: [{ email: { contains: search } }, { username: { contains: search } }],
        }
      : {}),
    ...(role
      ? {
          roles: {
            some: {
              role: {
                name: role,
                deletedAt: null,
              },
            },
          },
        }
      : {}),
    ...(Number.isInteger(unitId) && unitId > 0 ? { unitId } : {}),
    ...(isActiveRaw === "true" || isActiveRaw === "false"
      ? { isActive: isActiveRaw === "true" }
      : {}),
    ...(claimStatus === "claimed" ? { military: { isNot: null } } : {}),
    ...(claimStatus === "unclaimed" ? { military: { is: null } } : {}),
  };
}

export async function listAccounts({ actor, query }) {
  assertSuperAdmin(actor);

  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 20), 100);
  const where = buildListAccountsWhere(query);

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        military: {
          select: {
            id: true,
            fullname: true,
            militaryCode: true,
            rank: true,
            position: true,
            unitId: true,
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
          include: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    items: users.map((user) => ({
      id: user.id,
      email: user.email,
      username: user.username,
      isActive: user.isActive,
      unitId: user.unitId,
      unit: user.unit,
      military: user.military,
      roles: user.roles.map((r) => r.role.name),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function listUnits({ actor }) {
  assertSuperAdmin(actor);

  const units = await prisma.unit.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  return { units };
}

export async function listAudits({ actor, query }) {
  assertSuperAdmin(actor);

  const page = parsePositiveInteger(query.page, 1);
  const limit = Math.min(parsePositiveInteger(query.limit, 20), 100);
  const targetUserId = (query.targetUserId || "").trim();
  const action = (query.action || "").trim();

  const where = {
    ...(targetUserId ? { targetUserId } : {}),
    ...(action ? { action } : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.accountAuditLog.count({ where }),
    prisma.accountAuditLog.findMany({
      where,
      include: {
        actorUser: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        targetUser: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    items: logs.map((log) => ({
      id: log.id,
      action: log.action,
      metadata: log.metadata,
      createdAt: log.createdAt,
      actorUser: log.actorUser,
      targetUser: log.targetUser,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}
