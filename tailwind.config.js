/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        'serif': ['Lora', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
        'heading': ['Playfair Display', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'warm': {
          50: '#FAF5F0',
          100: '#F5EAE0',
          200: '#EBD5C0',
          300: '#DBBFA0',
          400: '#C9A880',
          500: '#B89060',
          600: '#A67D4B',
          700: '#8A673C',
          800: '#6E512F',
          900: '#523C23',
        },
      },
      typography: {
        DEFAULT: {
          css: {
            color: '#444',
            a: {
              color: '#8A673C',
              '&:hover': {
                color: '#6E512F',
              },
            },
            h1: {
              fontFamily: 'Playfair Display, serif',
            },
            h2: {
              fontFamily: 'Playfair Display, serif',
            },
            h3: {
              fontFamily: 'Playfair Display, serif',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
