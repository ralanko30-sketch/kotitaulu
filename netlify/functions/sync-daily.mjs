// Ajastettu synkronointi joka yö (klo 03 UTC = 05 Suomen aikaa)
import { runSync } from "../../lib/sync.mjs";

export default async () => {
  await runSync();
};

export const config = { schedule: "0 3 * * *" };
