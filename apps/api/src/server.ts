import { demoActors } from "./actors.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { createApp } from "./app.js";
import { createNotificationStub } from "./notifications/notification-stub.js";
import { startOutboxDispatcher } from "./notifications/outbox.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const app = createApp({ db, actors: demoActors() });
const dispatcher = startOutboxDispatcher(db, createNotificationStub());
const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, "127.0.0.1", () => {
  console.info(`BookerDoc API: http://localhost:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close(() => { void dispatcher.stop().finally(() => db.$disconnect()); }));
}
