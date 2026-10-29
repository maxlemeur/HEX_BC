import { notFound } from "next/navigation";

import { Prototype } from "./Prototype";
import "./prototype.css";

export default async function PilotagePrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { v } = await searchParams;
  const parsed = Number(v);
  const initialVariant = Number.isInteger(parsed) && parsed >= 1 && parsed <= 3 ? parsed - 1 : 0;
  return <Prototype initialVariant={initialVariant} />;
}
