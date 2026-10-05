require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$queryRaw`SELECT season, COUNT(*)::int as n FROM nfl_player_week_stats GROUP BY season ORDER BY season`
  .then((r) => {
    console.log(JSON.stringify(r));
    return p.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await p.$disconnect();
    process.exit(1);
  });
