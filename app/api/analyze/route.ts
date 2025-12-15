// app/api/analyze/route.ts
import { NextResponse } from 'next/server';
import { performFullAnalysis } from '@/lib/analysis';
import { saveAnalysis } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // если хочешь требовать логин – раскомментируй:
    // const user = await getSessionUser(req);
    // if (!user) {
    //   return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    // }

    const reqData = {
      address: body.address,
      blockchain: body.blockchain,
      depth: Number(body.depth) || 1,
    };

    const result = await performFullAnalysis(reqData);

    const user = await getSessionUser(req);
    const userId = user ? String(user.userId) : null;

    await saveAnalysis(userId, result);


    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('Error in /api/analyze', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
