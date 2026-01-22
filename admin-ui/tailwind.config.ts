import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#1e3a8a",
      },
    },
  },
  plugins: [],
};

export default config;
