/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#0b1120',
          900: '#111827',
          850: '#162033',
          800: '#1e293b',
        },
      },
    },
  },
  plugins: [],
};
