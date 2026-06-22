import type { Metadata, Viewport } from "next";
import { Comic_Neue } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const comic = Comic_Neue({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-comic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "your ai slop bores me 💀",
  description: "the ai is a real human. type a prompt, or be the ai and earn credits.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1a1a1e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={comic.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
