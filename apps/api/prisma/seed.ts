import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
if (new URL(connectionString).pathname !== "/bookerdoc") {
  throw new Error("Demo seed is intended only for the local bookerdoc database");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const patientId = "00000000-0000-4000-8000-000000000001";
const doctorId = "00000000-0000-4000-8000-000000000002";
const serviceId = "00000000-0000-4000-8000-000000000003";
try {
  await db.$transaction(async tx => {
    await tx.user.upsert({ where: { id: patientId }, update: {},
      create: { id: patientId, name: "Demo pacient", email: "patient@example.test" } });
    await tx.doctor.upsert({ where: { id: doctorId }, update: {},
      create: { id: doctorId, name: "Demo lékař" } });
    await tx.service.upsert({ where: { id: serviceId }, update: {},
      create: { id: serviceId, doctorId, name: "Konzultace", durationMinutes: 30 } });
    for (const weekday of [1, 2, 3, 4, 5]) {
      await tx.workingWindow.upsert({
        where: { doctorId_weekday_startMinute_endMinute: { doctorId, weekday, startMinute: 480, endMinute: 960 } },
        update: {}, create: { doctorId, weekday, startMinute: 480, endMinute: 960 },
      });
    }
  });
  console.info(JSON.stringify({ patientId, doctorId, serviceId, workingHours: "Mon–Fri 08:00–16:00 Europe/Prague" }));
} finally {
  await db.$disconnect();
}
