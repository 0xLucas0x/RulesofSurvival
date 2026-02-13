import { NextRequest, NextResponse } from 'next/server';
import { evaluateStoryServer } from '../../../../../lib/server/aiEngine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await evaluateStoryServer(body);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || 'Failed to evaluate story',
      },
      { status: 500 },
    );
  }
}
