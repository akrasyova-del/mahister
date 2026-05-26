/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        online: '#22c55e',
        offline: '#ef4444',
        weather: '#eab308',
        manual: '#3b82f6',
        partial: '#f97316',
        error: '#1f2937',
      },
    },
  },
  plugins: [],
}
