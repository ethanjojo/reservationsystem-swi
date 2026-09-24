import { z } from "zod";

export const reservationInput = z.strictObject({
  patientId: z.uuid(),
  doctorId: z.uuid(),
  serviceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }).refine(value => !/\.\d{4,}/.test(value), {
    message: "At most millisecond precision is supported",
  }),
});
export type ReservationInput = z.infer<typeof reservationInput>;
