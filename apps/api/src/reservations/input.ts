import { z } from "zod";

export const reservationInput = z.strictObject({
  patientId: z.uuid(),
  doctorId: z.uuid(),
  serviceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
});
export type ReservationInput = z.infer<typeof reservationInput>;
