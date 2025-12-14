// app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import type { WalletAnalysisRequest } from '@/lib/types';
import { performFullAnalysis } from '@/lib/analysis';
import { saveAnalysis } from '@/lib/db';

export async function POST(req: Request) {
  console.log('[API] /api/analyze: incoming request');

  try {
    const body = (await req.json()) as WalletAnalysisRequest;
    console.log('[API] /api/analyze body:', body);

    const result = await performFullAnalysis(body);

    // временный userId — потом заменишь на реальную авторизацию
    await saveAnalysis('demo-user-id', result);

    console.log('[API] /api/analyze OK, riskScore =', result.globalRiskScore);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('[API] /api/analyze ERROR:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
