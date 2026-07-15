import "dotenv/config";
import { runMemberStartSnapshot } from "../jobs/memberStartSnapshot.js";
import { prisma } from "../db.js";

const result = await runMemberStartSnapshot();
console.log(JSON.stringify(result));
await prisma.$disconnect();
