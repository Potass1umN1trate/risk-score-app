// app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import type { WalletAnalysisRequest } from '@/lib/types';
import { performFullAnalysis } from '@/lib/analysis';
import { saveAnalysis } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as WalletAnalysisRequest;

    if (!body.address || !body.blockchain || !body.depth) {
      return NextResponse.json(
        { message: 'Invalid payload' },
        { status: 400 },
      );
    }

    const result = await performFullAnalysis(body);

    // пока демо-пользователь
    await saveAnalysis('demo-user-id', result);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('[API] /api/analyze error', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
