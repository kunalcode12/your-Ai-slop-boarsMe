import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1a1a1e", // dark background
        "ink-soft": "#26262c", // raised panels
        "ink-line": "#3a3a44", // borders
        paper: "#e9e7e0", // off-white text
        "paper-dim": "#a3a1ad",
        slop: "#ff5c8a", // hot pink accent
        slop2: "#5cc8ff", // blue accent
        slime: "#b6ff5c", // +1 / success
        danger: "#ff5252",
      },
      fontFamily: {
        comic: ['var(--font-comic)', '"Comic Sans MS"', '"Comic Neue"', "cursive"],
      },
      boxShadow: {
        chunk: "4px 4px 0 0 #000",
        "chunk-sm": "2px 2px 0 0 #000",
      },
      keyframes: {
        bob: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-3px)" } },
        pop: { "0%": { transform: "scale(0.6)", opacity: "0" }, "60%": { transform: "scale(1.15)" }, "100%": { transform: "scale(1)", opacity: "1" } },
        floatup: { "0%": { transform: "translateY(0)", opacity: "1" }, "100%": { transform: "translateY(-40px)", opacity: "0" } },
      },
      animation: {
        bob: "bob 1.2s ease-in-out infinite",
        pop: "pop 0.25s ease-out",
        floatup: "floatup 1s ease-out forwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
