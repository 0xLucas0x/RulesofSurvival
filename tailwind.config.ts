import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'sickly-green': '#4a5d4e',
        'sickly-green-dark': '#2c382f',
        rust: '#8b4513',
        'rust-light': '#cd853f',
        'blood-fresh': '#8a0303',
        'blood-dried': '#420b0b',
        'hospital-white': '#e0e6e1',
        'metal-grey': '#708090',
        'metal-dark': '#2f4f4f',
      },
      fontFamily: {
        header: ['Special Elite', 'serif'],
        body: ['Noto Serif SC', 'Crimson Text', 'serif'],
        hand: ['Ma Shan Zheng', 'cursive'],
        tech: ['Share Tech Mono', 'monospace'],
        horror: ['Creepster', 'cursive'],
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        flicker: 'flicker 3s linear infinite',
      },
      keyframes: {
        flicker: {
          '0%, 19.999%, 22%, 62.999%, 64%, 64.999%, 70%, 100%': { opacity: '0.99' },
          '20%, 21.999%, 63%, 63.999%, 65%, 69.999%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
