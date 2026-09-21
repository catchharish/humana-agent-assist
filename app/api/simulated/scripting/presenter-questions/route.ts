import { NextResponse } from "next/server";
import { envelope, readFixture } from "@/app/api/simulated/_data";

type PresenterQuestion = {
  topic: string;
  question: string;
};

export async function GET() {
  const questions = readFixture<PresenterQuestion[]>(
    "presenter_questions.json",
  ).map(({ topic, question }) => ({ topic, question }));
  return NextResponse.json(envelope("scripting", { questions }));
}
