import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DynamicWalletProvider } from '../components/DynamicWalletProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rule of Survival | ANOMALY_SYS.v0.9',
  description: 'Rules Horror text adventure game',
  icons: {
    icon: '/hospital_corridor_blur.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400&family=Special+Elite&family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <DynamicWalletProvider>{children}</DynamicWalletProvider>
      </body>
    </html>
  );
}
