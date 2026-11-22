import { NextResponse } from "next/server";
import { readRuntimePolicy } from "@/lib/read-runtime-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readRuntimePolicy(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read runtime policy" }, { status: 500 });
  }
}
