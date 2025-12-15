// app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import { performFullAnalysis } from '@/lib/analysis';
import { saveAnalysis, autoFlagBadAddress } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import type { WalletAnalysisRequest } from '@/lib/types';

// Порог, начиная с которого мы считаем адрес достаточно рискованным,
// чтобы тащить его в bad_addresses. Если хочешь literally "любое > 0",
// ставь 1.
const AUTO_BAD_THRESHOLD = 30;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const reqData: WalletAnalysisRequest = {
      address: String(body.address ?? '').trim(),
      blockchain: body.blockchain,
      depth: Number(body.depth) || 1,
    };

    const result = await performFullAnalysis(reqData);

    // Проверяем, есть ли связи с уже известными плохими адресами
    const hasBadNeighbors = result.graph.nodes.some(
      (n) =>
        n.id !== result.rootAddress &&
        (n.isSuspicious || !!n.badTag || !!n.badSource),
    );

    // Если риск достаточно высокий и есть "плохие соседи" — автофлагим root-адрес
    if (result.globalRiskScore >= AUTO_BAD_THRESHOLD && hasBadNeighbors) {
      try {
        await autoFlagBadAddress({
          blockchain: result.blockchain,
          address: result.rootAddress,
          riskLevel: result.globalRiskScore,
        });
      } catch (e) {
        // важно: не ронять сам анализ, если автофлаг сломался
        console.error('Failed to auto-flag bad address', e);
      }
    }

    const user = await getSessionUser(req);
    // У тебя здесь была ошибка: в AuthSession поле userId, а не id
    const userId = user ? String(user.userId) : null;

    await saveAnalysis(userId, result);

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('Error in /api/analyze', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
