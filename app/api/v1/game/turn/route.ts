import { NextRequest, NextResponse } from 'next/server';
import { generateNextTurnServer } from '../../../../../lib/server/aiEngine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await generateNextTurnServer(body);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || 'Failed to generate next turn',
      },
      { status: 500 },
    );
  }
}
