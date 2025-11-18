// app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import type { WalletAnalysisRequest, WalletAnalysisResult } from '@/lib/types';
import { performFullAnalysis } from '@/lib/analysis';
import { saveAnalysis } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as WalletAnalysisRequest;

    if (!body.address || !body.blockchain || !body.depth) {
      return NextResponse.json(
        { message: 'Не указаны обязательные параметры' },
        { status: 400 },
      );
    }

    // Здесь можно делать дополнительную валидацию адреса
    if (body.depth < 1 || body.depth > 5) {
      return NextResponse.json(
        { message: 'Глубина анализа должна быть от 1 до 5' },
        { status: 400 },
      );
    }

    // Основной анализ (сбор транзакций -> граф -> метрики -> risk score)
    const result: WalletAnalysisResult = await performFullAnalysis(body);

    // Сохранение в истории пользователя (пока без реальной авторизации)
    // В проде ты будешь доставать userId из токена/сессии
    await saveAnalysis('demo-user-id', result);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('Analyze error:', err);
    return NextResponse.json(
      { message: 'Внутренняя ошибка сервера' },
      { status: 500 },
    );
  }
}
