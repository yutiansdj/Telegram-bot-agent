/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dbe6fe', 200: '#bfd3fe', 300: '#93b4fd',
          400: '#6090fa', 500: '#3b6df6', 600: '#2450eb', 700: '#1d3cd8',
          800: '#1e34af', 900: '#1e318a',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        pop: '0 12px 32px rgba(16,24,40,0.12)',
      },
    },
  },
  plugins: [],
};
