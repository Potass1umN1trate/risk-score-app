// app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import { performFullAnalysis } from '@/lib/analysis';
import { saveAnalysis, autoFlagBadAddress } from '@/lib/db';
import { getSessionUser } from '@/lib/auth-session';
import type { WalletAnalysisRequest } from '@/lib/types';

const AUTO_BAD_THRESHOLD = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const reqData: WalletAnalysisRequest = {
      address: String(body.address ?? '').trim(),
      blockchain: body.blockchain,
      depth: Number(body.depth) || 1,
    };

    if (!reqData.address || !reqData.blockchain) {
      return NextResponse.json(
        { message: 'Invalid request data' },
        { status: 400 },
      );
    }

    // 1️⃣ Выполняем анализ (разрешён без логина)
    const result = await performFullAnalysis(reqData);

    // 2️⃣ Проверяем плохих соседей
    const hasBadNeighbors = result.graph.nodes.some(
      (n) =>
        n.id !== result.rootAddress &&
        (n.isSuspicious || !!n.badTag || !!n.badSource),
    );

    // 3️⃣ Автофлаг (НЕ критичен)
    if (result.globalRiskScore >= AUTO_BAD_THRESHOLD && hasBadNeighbors) {
      try {
        await autoFlagBadAddress({
          blockchain: result.blockchain,
          address: result.rootAddress,
          riskLevel: result.globalRiskScore,
        });
      } catch (e) {
        console.error('Failed to auto-flag bad address', e);
      }
    }

    // 4️⃣ Сохраняем историю ТОЛЬКО если пользователь залогинен
    const user = await getSessionUser();

    if (user && user.userId) {
      await saveAnalysis(String(user.userId), result);
    }

    // 5️⃣ Возвращаем результат в любом случае
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('Error in /api/analyze', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
