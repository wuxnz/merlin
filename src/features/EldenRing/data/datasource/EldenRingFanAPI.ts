import axios from "axios";
import Database from "better-sqlite3";

// import EldenRingFanAPIEndpoint from "../models/EldenRingFanAPIEndpoint";
import levenshteinDistance from "../../../../utils/levenshteinDistance";

class EldenRingFanAPI {
  private readonly baseUrl: string = "https://eldenring.fanapis.com/api";

  private db: Database.Database;

  private readonly categories: string[] = [
    "ammos",
    "armors",
    "ashes",
    "bosses",
    "classes",
    "creatures",
    "incantations",
    "items",
    "locations",
    "npcs",
    "shields",
    "sorceries",
    "spirits",
    "talismans",
    "weapons",
  ];

  constructor(dbPath: string = "eldenringfanapi.db") {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema() {
    // Use a simple table with id (api id), name (for quick searching), category, and the full JSON payload
    const createTableSQL = `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      data TEXT NOT NULL
    );`;
    this.db.exec(createTableSQL);
  }

  async createDatabase(): Promise<void> {
    const insertStmt = this.db.prepare(
      `INSERT OR REPLACE INTO items (id, name, category, data) VALUES (@id, @name, @category, @data)`
    );

    const insertMany = this.db.transaction((items: any[], category: string) => {
      for (const item of items) {
        insertStmt.run({
          id: item.id,
          name: item.name,
          category,
          data: JSON.stringify(item),
        });
      }
    });

    for (const category of this.categories) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const response = await axios.get(
          `${this.baseUrl}/${category}?limit=20&page=${page}`
        );
        if (response.data.count === 0) {
          hasMore = false;
        } else {
          insertMany(response.data.data, category);
          console.log(
            `${category} fetched & saved (${response.data.data.length} items)`
          );
          // throttle requests
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        page++;
      }
    }
  }

  async search(query: string): Promise<Record<string, any>> {
    const rows = this.db.prepare(`SELECT name, data FROM items`).all() as {
      name: string;
      data: string;
    }[];

    type Candidate = { item: any; distance: number };

    const candidates: Candidate[] = rows.map(
      (row: { name: string; data: string }) => {
        const item = JSON.parse(row.data);
        const distance = levenshteinDistance(
          query.toLowerCase(),
          row.name.toLowerCase()
        );
        return { item, distance };
      }
    );

    if (candidates.length === 0) {
      throw new Error("Database is empty. Have you run createDatabase()?");
    }

    const best = candidates.sort(
      (a: Candidate, b: Candidate) => a.distance - b.distance
    )[0];
    return best.item;
  }

  // async search(query: string): Promise<Record<string, any>> {
  //   const rows = this.db
  //     .prepare(`SELECT name, data FROM items WHERE name LIKE ?`)
  //     .all(`%${query}%`) as { name: string; data: string }[];
  //   if (rows.length === 0) {
  //     throw new Error("Database is empty. Have you run createDatabase()?");
  //   }
  //   return rows[0];
  // }
}

export default EldenRingFanAPI;
