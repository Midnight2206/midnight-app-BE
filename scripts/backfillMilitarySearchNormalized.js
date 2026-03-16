import { prisma } from "#configs/prisma.config.js";
import { buildMilitarySearchNormalized } from "#utils/searchNormalizer.js";

const BATCH_SIZE = 300;

async function backfill() {
  let totalUpdated = 0;

  // Process all rows to ensure legacy data can be searched without accents.
  for (;;) {
    const rows = await prisma.military.findMany({
      where: {
        deletedAt: null,
        searchNormalized: "",
      },
      take: BATCH_SIZE,
      include: {
        unit: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!rows.length) break;

    await prisma.$transaction(
      rows.map((row) =>
        prisma.military.update({
          where: {
            id: row.id,
          },
          data: {
            searchNormalized: buildMilitarySearchNormalized({
              fullname: row.fullname,
              militaryCode: row.militaryCode,
              rank: row.rank,
              position: row.position,
              gender: row.gender,
              type: row.type,
              assignedUnit: row.assignedUnit,
              unitName: row.unit?.name,
            }),
          },
        }),
      ),
    );

    totalUpdated += rows.length;
    console.log(`Backfilled ${totalUpdated} militaries...`);
  }

  console.log(`Done. Total updated militaries: ${totalUpdated}`);
}

backfill()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
