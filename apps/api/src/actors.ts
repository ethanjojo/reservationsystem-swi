/** Identity: maps a demo bearer token to an Actor. Authorization rules (BR-05) live in reservations/lifecycle.ts. */
export type Actor = { role: "patient" | "doctor"; id: string };
export function demoActors(): Map<string, Actor> {
  const actors = new Map<string, Actor>();
  const patient = process.env.DEMO_PATIENT_TOKEN, doctor = process.env.DEMO_DOCTOR_TOKEN;
  if (patient && patient === doctor) throw new Error("Demo tokens must differ");
  if (patient) actors.set(patient, { role: "patient", id: "00000000-0000-4000-8000-000000000001" });
  if (doctor) actors.set(doctor, { role: "doctor", id: "00000000-0000-4000-8000-000000000002" });
  return actors;
}
