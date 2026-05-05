import "dotenv/config";
import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { commands, handleInteraction, slashEphemeral } from "./bot/commands.js";
import { prisma } from "./db.js";
import {
  commandAllowedWithoutSubscription,
  ensureUserForDiscord,
  userHasActiveCommercialAccess,
} from "./entitlement.js";
import { runHourlyDigest } from "./jobs/hourly.js";
import { log } from "./logging.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID");
  process.exit(1);
}

const discordToken = token;
const discordClientId = clientId;

function slashCommandNames(): string[] {
  return commands.map((c) => (c as { name: string }).name).filter(Boolean);
}

async function registerSlashCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(discordToken);
  const names = slashCommandNames().join(", ");
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(discordClientId, guildId), { body: commands });
    console.log(`Registered ${commands.length} guild slash commands for guild ${guildId}: ${names}`);
    // DMs and “this command is outdated” errors use **global** command definitions. Guild-only registration
    // never updates those, so slash in DM stays stale. Always mirror the same commands globally.
    await rest.put(Routes.applicationCommands(discordClientId), { body: commands });
    console.log(
      `Registered ${commands.length} global slash commands (for DMs / other servers; may take up to ~1h to propagate): ${names}`,
    );
  } else {
    await rest.put(Routes.applicationCommands(discordClientId), { body: commands });
    console.log(`Registered ${commands.length} global slash commands (may take up to ~1h to show everywhere): ${names}`);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Ready as ${c.user.tag}`);
  const hourMs = 3_600_000;
  setInterval(() => {
    void runHourlyDigest(c).catch((err) =>
      log.error("hourly_digest_failed", { err: err instanceof Error ? err.message : String(err) }),
    );
  }, hourMs);
  void runHourlyDigest(c).catch((err) =>
    log.error("hourly_digest_initial_failed", { err: err instanceof Error ? err.message : String(err) }),
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await ensureUserForDiscord(interaction.user.id);
    if (!commandAllowedWithoutSubscription(interaction.commandName)) {
      const ok = await userHasActiveCommercialAccess(interaction.user.id);
      if (!ok) {
        const billingUrl =
          process.env.BILLING_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        await interaction.reply({
          content:
            `This bot requires an active subscription.\nOpen **${billingUrl}** to sign in with Discord and subscribe.\n` +
            `Use the **same Discord account** you use here. Commands like **/link** stay available without a subscription.`,
          ...slashEphemeral(interaction),
        });
        return;
      }
    }
    await handleInteraction(interaction);
  } catch (e) {
    log.error("interaction_handler_failed", { err: e instanceof Error ? e.message : String(e) });
    const msg = e instanceof Error ? e.message : "Error";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, ...slashEphemeral(interaction) }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ...slashEphemeral(interaction) }).catch(() => {});
    }
  }
});

console.log("[startup] Registering slash commands…");
await registerSlashCommands();
console.log("[startup] Connecting to database…");
await prisma.$connect();
console.log("[startup] Logging in to Discord…");
await client.login(discordToken);

async function shutdown(): Promise<void> {
  await client.destroy();
  await prisma.$disconnect();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
