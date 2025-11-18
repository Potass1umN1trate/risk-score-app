// app/api/history/route.ts
import { NextResponse } from 'next/server';
import { getUserHistory } from '@/lib/db';

export async function GET() {
  // Пока без реальной авторизации
  const userId = 'demo-user-id';
  const history = await getUserHistory(userId);
  return NextResponse.json(history);
}
