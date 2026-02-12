import { NextRequest, NextResponse } from 'next/server';
import { fetchOpenAIModelsServer } from '../../../../../lib/server/aiEngine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const models = await fetchOpenAIModelsServer(body.baseUrl || '', body.apiKey || '');
    return NextResponse.json({ models });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch models' }, { status: 500 });
  }
}
