import "dotenv/config";
import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import { commands, handleInteraction } from "./bot/commands.js";
import { prisma } from "./db.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID");
  process.exit(1);
}

const discordToken = token;
const discordClientId = clientId;

async function registerSlashCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(discordToken);
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(discordClientId, guildId), { body: commands });
    console.log(`Registered ${commands.length} guild commands for ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(discordClientId), { body: commands });
    console.log(`Registered ${commands.length} global commands (can take up to an hour to appear)`);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Ready as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleInteraction(interaction);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Error";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

await registerSlashCommands();
await prisma.$connect();
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
