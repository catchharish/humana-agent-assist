import { NextResponse } from "next/server";
import { applyDemoHeaders, envelope, readFixture } from "@/app/api/simulated/_data";

type Article = { articleId: string };

export async function GET(
  request: Request,
  context: { params: Promise<{ articleId: string }> },
) {
  await applyDemoHeaders(request);
  const { articleId } = await context.params;
  const rows = readFixture<Article[]>("articles.json");
  const row = rows.find((a) => a.articleId === articleId);
  if (!row) {
    return NextResponse.json(envelope("scripting", { error: "not_found" }), {
      status: 404,
    });
  }
  return NextResponse.json(envelope("scripting", row));
}
