import { notFound } from "next/navigation";

import { PerformanceBenchmark } from "@/components/performance-benchmark";

export const dynamic = "force-dynamic";

export default function BenchmarkPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <PerformanceBenchmark />;
}
