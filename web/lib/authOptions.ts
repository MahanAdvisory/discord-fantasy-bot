import type { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";
import { prisma } from "@fantasy/db";

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ profile, account }) {
      const id =
        (profile as { id?: string } | undefined)?.id ??
        (account?.provider === "discord" ? account.providerAccountId : undefined);
      if (!id) return true;
      await prisma.user.upsert({
        where: { discordUserId: id },
        create: { discordUserId: id },
        update: {},
      });
      return true;
    },
    async jwt({ token, account, profile }) {
      if (profile && typeof (profile as { id?: string }).id === "string") {
        token.discordId = (profile as { id: string }).id;
      } else if (account?.provider === "discord" && account.providerAccountId) {
        token.discordId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.discordId === "string") {
        (session.user as { discordId?: string }).discordId = token.discordId;
      }
      return session;
    },
  },
};
