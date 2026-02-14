import { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE_NAME } from '../../lib/server/appConfig';
import { getAuthUserFromToken } from '../../lib/server/auth';

export default async function LabLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    redirect('/');
  }

  const user = await getAuthUserFromToken(token).catch(() => null);
  if (!user || user.role !== 'ADMIN') {
    redirect('/');
  }

  return <>{children}</>;
}
