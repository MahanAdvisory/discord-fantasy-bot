import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@fantasy/db";

const hasDiscordAuth = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
const hasEmailAuth = Boolean(process.env.EMAIL_SERVER && process.env.EMAIL_FROM);
const hasGoogleAuth = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  providers: [
    ...(hasDiscordAuth
      ? [
          DiscordProvider({
            clientId: process.env.DISCORD_CLIENT_ID ?? "",
            clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
          }),
        ]
      : []),
    ...(hasEmailAuth
      ? [
          EmailProvider({
            server: process.env.EMAIL_SERVER,
            from: process.env.EMAIL_FROM,
            maxAge: 24 * 60 * 60,
          }),
        ]
      : []),
    ...(hasGoogleAuth
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID ?? "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          }),
        ]
      : []),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async signIn({ profile, account, user }) {
      const oauthId =
        (profile as { id?: string; sub?: string } | undefined)?.id ??
        (profile as { id?: string; sub?: string } | undefined)?.sub ??
        account?.providerAccountId;
      const email = user?.email?.trim().toLowerCase() ?? null;
      if (!oauthId && !email) return true;

      const provider = account?.provider ?? "email";
      const oauthUpdate =
        provider === "discord"
          ? { discordUserId: oauthId ?? undefined }
          : provider === "google"
            ? { googleUserId: oauthId ?? undefined }
            : {};

      if (oauthId && provider !== "email") {
        const byEmail = email ? await prisma.user.findUnique({ where: { email } }) : null;
        if (byEmail) {
          await prisma.user.update({
            where: { id: byEmail.id },
            data: { ...oauthUpdate, ...(email ? { email } : {}) },
          });
          return true;
        }
        if (provider === "discord") {
          await prisma.user.upsert({
            where: { discordUserId: oauthId },
            create: { discordUserId: oauthId, ...(email ? { email } : {}) },
            update: { ...(email ? { email } : {}) },
          });
        } else if (provider === "google") {
          await prisma.user.upsert({
            where: { googleUserId: oauthId },
            create: { googleUserId: oauthId, ...(email ? { email } : {}) },
            update: { ...(email ? { email } : {}) },
          });
        }
        return true;
      }

      if (email) {
        await prisma.user.upsert({
          where: { email },
          create: { email },
          update: {},
        });
      }
      return true;
    },
    async jwt({ token, account, profile }) {
      if (profile && typeof (profile as { id?: string }).id === "string") {
        token.discordId = (profile as { id: string }).id;
      } else if (account?.provider === "discord" && account.providerAccountId) {
        token.discordId = account.providerAccountId;
      }
      if (profile && typeof (profile as { sub?: string }).sub === "string") {
        token.googleId = (profile as { sub: string }).sub;
      } else if (account?.provider === "google" && account.providerAccountId) {
        token.googleId = account.providerAccountId;
      }
      if (typeof token.email === "string") token.email = token.email.toLowerCase();
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.discordId === "string") {
        (session.user as { discordId?: string }).discordId = token.discordId;
      }
      if (session.user && typeof token.email === "string") {
        (session.user as { email?: string }).email = token.email;
      }
      if (session.user && typeof token.googleId === "string") {
        (session.user as { googleId?: string }).googleId = token.googleId;
      }
      return session;
    },
  },
};
