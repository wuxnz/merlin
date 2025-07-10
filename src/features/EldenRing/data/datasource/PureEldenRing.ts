import Database from "better-sqlite3";
import EldenRingData from "../models/EldenRingData";
import { v4 as uuidv4 } from "uuid";

import axios from "axios";
import * as cheerio from "cheerio";

import levenshteinDistance from "../../../../utils/levenshteinDistance";

type CategoryWithPagination = {
  category: string;
  pagination: boolean;
};

class PureEldenRing {
  private readonly baseUrl: string = "https://www.pureeldenring.com";

  private db: Database.Database;

  private readonly categories: CategoryWithPagination[] = [
    { category: "elden-ring-nightreign", pagination: true },
    { category: "guidecats/classes", pagination: false },
    { category: "elden-ring-skills", pagination: false },
    { category: "ashes-of-war", pagination: false },
    { category: "guides/spells", pagination: false },
    { category: "items", pagination: true },
    { category: "weapon", pagination: true },
    { category: "armor", pagination: true },
  ];

  constructor(dbPath: string = "pureeldenring.db") {
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

    console.log("Populating database...");

    for (const category of this.categories) {
      let page = 1;
      let hasMorePages = category.pagination;
      while (hasMorePages) {
        console.log(
          `Fetching ${category.category} page ${page}: ${this.baseUrl}/${category.category}/page/${page}`
        );
        var response;
        try {
          response = await axios.get(
            `${this.baseUrl}/${category.category}/page/${page}`
          );
        } catch (err: any) {
          console.error(
            `Error fetching ${category.category} page ${page}: ${this.baseUrl}/${category.category}/page/${page}`,
            err
          );
          hasMorePages = false;
          break;
        }
        console.log(
          `${category.category} page ${page} fetched & saved (${response.data.length} items)`
        );
        const $ = cheerio.load(response.data);
        const items: EldenRingData[] = [];

        $("table").each((_, table) => {
          const columns = $(table).find("th");
          const columnNames = columns
            .toArray()
            .map((column) => $(column).text().trim());
          const nameColumnIndex = columns
            .toArray()
            .findIndex(
              (column) =>
                $(column).text().trim().includes("Name") ||
                $(column).text().trim() === "Name"
            );
          const iconColumnIndex = columns
            .toArray()
            .findIndex((column) => $(column).text().trim() === "Icon");
          const rows = $(table).find("tr");
          rows.each((_, row) => {
            const id = uuidv4();
            const name = $(row).find("td").eq(nameColumnIndex).text().trim();
            if (name === "") return;
            const data: Record<string, any> = {};
            for (let i = 0; i < columnNames.length; i++) {
              if (i === nameColumnIndex) continue;
              if (i === iconColumnIndex) {
                const iconUrl = $(row).find("td").eq(i).find("img").attr("src");
                if (iconUrl) {
                  data["icon"] = iconUrl.startsWith("/")
                    ? `${this.baseUrl}${iconUrl}`
                    : iconUrl;
                }
                continue;
              }
              const columnName = columnNames[i];
              const value = $(row).find("td").eq(i).text().trim();
              data[columnName] = value;
            }
            items.push({ id, name, category: category.category, data });
          });
        });

        if (items.length === 0) {
          hasMorePages = false;
        } else if (
          page > 1 &&
          // check if any items are the same as an item from the last page
          items.every((item) =>
            this.db
              .prepare("SELECT * FROM items WHERE name = ? AND category = ?")
              .get(item.name, item.data, category.category)
          )
        ) {
          console.log(
            `Items from page ${page} are identical to items from the last page. Skipping.`
          );
          hasMorePages = false;
          break;
        } else {
          if (hasMorePages) {
            insertMany(items, category.category);
            console.log(
              `${category.category} fetched & saved (${items.length} items)`
            );
            page++;
          }
        }
      }
    }
    console.log("Database population complete.");
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
}

export default PureEldenRing;
