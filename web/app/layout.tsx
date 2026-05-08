import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Fantasy dashboard",
  description: "Leagues, drafts, and activity across your linked fantasy accounts",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col antialiased font-sans">
        <Providers>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          <footer
            className="mt-auto flex flex-col items-center gap-2 border-t border-zinc-200/90 px-4 py-3 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
            role="contentinfo"
          >
            <p>
              This site is not affiliated with any fantasy football provider, such as ESPN,
              Sleeper, or others.
            </p>
            <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <Link href="/privacy" className="hover:underline">
                Privacy Policy
              </Link>
              <span aria-hidden="true">·</span>
              <Link href="/terms" className="hover:underline">
                Terms of Use
              </Link>
            </nav>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
