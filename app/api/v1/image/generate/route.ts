import { NextRequest, NextResponse } from 'next/server';
import { generateImageServer } from '../../../../../lib/server/aiEngine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const imageUrl = await generateImageServer(body);
    return NextResponse.json({ imageUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to generate image' }, { status: 500 });
  }
}
