import {
  ApplicationCommandOptionType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import dotenv from "dotenv";
import fs from "fs";
import Database from "better-sqlite3";

import EldenRingFanAPI from "./features/EldenRing/data/datasource/EldenRingFanAPI";
import PureEldenRing from "./features/EldenRing/data/datasource/PureEldenRing";

// Load environment variables from .env file
dotenv.config();

const clientId = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_TOKEN;

if (!token || !clientId) {
  console.error(
    "[ERROR] DISCORD_TOKEN or CLIENT_ID environment variable is not set."
  );
  process.exit(1);
}

// Slash commands to be registered
const slashCommands = [
  {
    name: "ping",
    description: "Ping the bot",
  },
  {
    name: "eldenring",
    description: "Search for an item in the database",
    options: [
      {
        name: "source",
        description: "The source to search from",
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: "Elden Ring Fan API", value: "elden-ring-fan-api" },
          { name: "Pure Elden Ring", value: "pure-elden-ring" },
        ],
      },
      {
        name: "query",
        description: "The query to search for",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
];

// Register slash commands
async function registerCommands(
  clientId: string,
  token: string,
  slashCommands: any[]
) {
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    console.log("Started refreshing application (/) commands.");

    // The put method is used to fully refresh all commands in the guild with the current set
    await rest.put(Routes.applicationCommands(clientId), {
      body: slashCommands,
    });

    console.log("Successfully registered slash commands.");
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
}

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Recursively format nested objects/arrays into human-readable lines
function formatKeyValue(key: string, value: any, depth = 0): string {
  const indent = "  ".repeat(depth);

  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "";

    const filtered = value.filter((v) => {
      return !(
        typeof v === "object" &&
        v !== null &&
        "name" in v &&
        "amount" in v &&
        (v as any).amount === 0
      );
    });

    if (filtered.length === 0) return "";

    const children = filtered
      .map((v) => formatKeyValue("-", v, depth + 1))
      .filter(Boolean)
      .join("\n");
    return `${indent}${key}:\n${children}`;
  }

  if (typeof value === "object") {
    const children = Object.entries(value)
      .map(([k, v]) => formatKeyValue(k, v, depth + 1))
      .filter(Boolean)
      .join("\n");
    if (!children) return "";
    return `${indent}${key}:\n${children}`;
  }

  return `${indent}${key}: ${value}`;
}

// Initialize EldenRing API datasource once and reuse it
const eldenRingFanApi = new EldenRingFanAPI();

// Initialize PureEldenRing API datasource once and reuse it
const pureEldenRingApi = new PureEldenRing();

client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user?.tag}!`);

  // Only populate the database if it hasn't been created yet
  const eldenRingFanApiDBPath = "eldenringfanapi.db";
  let needInitEldenRingApi = false;
  const pureEldenRingDBPath = "pureeldenring.db";
  let needInitPureEldenRing = false;

  if (!fs.existsSync(eldenRingFanApiDBPath)) {
    needInitEldenRingApi = true;
  } else {
    try {
      const db = new Database(eldenRingFanApiDBPath, { readonly: true });
      // Check if the items table exists and contains rows
      const stmt = db.prepare(
        "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='items'"
      );
      const tableExists = (stmt.get() as { cnt: number }).cnt === 1;
      let rowCount = 0;
      if (tableExists) {
        rowCount = (
          db.prepare("SELECT COUNT(*) as cnt FROM items").get() as {
            cnt: number;
          }
        ).cnt;
      }
      db.close();
      if (!tableExists || rowCount === 0) {
        needInitEldenRingApi = true;
      }
    } catch (err: any) {
      console.error("Error reading existing database, will recreate:", err);
      needInitEldenRingApi = true;
    }
  }

  if (!fs.existsSync(pureEldenRingDBPath)) {
    needInitPureEldenRing = true;
  } else {
    try {
      const db = new Database(pureEldenRingDBPath, { readonly: true });
      const rowCount = db
        .prepare("SELECT COUNT(*) as cnt FROM items")
        .get() as {
        cnt: number;
      };
      db.close();
      if (rowCount.cnt === 0) {
        needInitPureEldenRing = true;
      }
    } catch (err: any) {
      console.error("Error reading existing database, will recreate:", err);
      needInitPureEldenRing = true;
    }
  }

  if (needInitEldenRingApi) {
    console.log(
      "Database missing or empty. Creating and populating it—this may take a while..."
    );
    await eldenRingFanApi.createDatabase();
    console.log("Database created.");
  } else {
    console.log(
      "Database already initialized and populated. Skipping creation."
    );
  }

  if (needInitPureEldenRing) {
    console.log(
      "Database missing or empty. Creating and populating it—this may take a while..."
    );
    await pureEldenRingApi.createDatabase();
    console.log("Database created.");
  } else {
    console.log(
      "Database already initialized and populated. Skipping creation."
    );
  }

  registerCommands(clientId, token, slashCommands);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isCommand()) return;
  const command = slashCommands.find(
    (cmd) => cmd.name === interaction.commandName
  );
  if (!command) return;
  try {
    if (command.name === "ping") {
      await interaction.reply("Pong!");
    }
    if (command.name === "eldenring") {
      if (!interaction.isChatInputCommand()) return;
      const source = interaction.options.getString("source");
      const query = interaction.options.getString("query");

      if (!source || !query) {
        await interaction.reply("Please provide a source and a query");
        return;
      }

      if (source === "elden-ring-fan-api") {
        const result = await eldenRingFanApi.search(query);
        const formattedDetails = Object.entries(result)
          .filter(
            ([key, _]) =>
              key !== "name" && key !== "description" && key !== "image"
          )
          .map(([key, value]) => formatKeyValue(key, value))
          .filter(Boolean)
          .join("\n");

        const embed = new EmbedBuilder()
          .setColor(0x6f11db)
          .setTitle(result.name)
          .setDescription(`${result.description}\n\n${formattedDetails}`)
          .setImage(result.image)
          .setFooter({ text: "Merlin go brrr" });
        await interaction.reply({ embeds: [embed] });
      } else if (source === "pure-elden-ring") {
        const result = await pureEldenRingApi.search(query);
        const formattedDetails = Object.entries(result)
          .filter(
            ([key, _]) =>
              key !== "name" && key !== "description" && key !== "image"
          )
          .map(([key, value]) => formatKeyValue(key, value))
          .filter(Boolean)
          .join("\n");

        const embed = new EmbedBuilder()
          .setColor(0x6f11db)
          .setTitle(result.name)
          .setDescription(`${result.description}\n\n${formattedDetails}`)
          .setImage(result.image)
          .setFooter({ text: "Merlin go brrr" });
        await interaction.reply({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "There was an error while executing this command!",
    });
  }
});

client.login(token);
