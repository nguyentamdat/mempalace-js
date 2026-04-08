import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_KG_PATH = join(homedir(), ".mempalace", "knowledge.db");

export interface Entity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  createdAt: string;
}

export interface Triple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom: string | null;
  validTo: string | null;
  confidence: number;
  sourceCloset: string | null;
  sourceFile: string | null;
  extractedAt: string;
}

export interface QueryResult {
  direction?: "outgoing" | "incoming";
  subject: string;
  predicate: string;
  object: string;
  validFrom: string | null;
  validTo: string | null;
  confidence?: number;
  sourceCloset?: string | null;
  current: boolean;
}

export interface StatsResult {
  entities: number;
  triples: number;
  currentFacts: number;
  expiredFacts: number;
  relationshipTypes: string[];
}

interface EntityFact {
  full_name?: string;
  type?: string;
  gender?: string;
  birthday?: string;
  parent?: string;
  partner?: string;
  relationship?: string;
  sibling?: string;
  owner?: string;
  interests?: string[];
}

interface QueryEntityRow {
  predicate: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number;
  source_closet: string | null;
  related_name: string;
}

interface TimelineRow {
  predicate: string;
  valid_from: string | null;
  valid_to: string | null;
  sub_name: string;
  obj_name: string;
}

interface CountRow {
  count: number;
}

interface PredicateRow {
  predicate: string;
}

export class KnowledgeGraph {
  public readonly dbPath: string;
  private readonly db: Database;

  constructor(dbPath?: string | null) {
    this.dbPath = dbPath ?? DEFAULT_KG_PATH;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.initDb();
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'unknown',
        properties TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS triples (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL DEFAULT 1.0,
        source_closet TEXT,
        source_file TEXT,
        extracted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subject) REFERENCES entities(id),
        FOREIGN KEY (object) REFERENCES entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
      CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
      CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
      CREATE INDEX IF NOT EXISTS idx_triples_valid ON triples(valid_from, valid_to);
    `);
  }

  private entityId(name: string): string {
    return name.toLowerCase().replaceAll(" ", "_").replaceAll("'", "");
  }

  addEntity(
    name: string,
    entityType = "unknown",
    properties: Record<string, unknown> | null = null,
  ): string {
    const id = this.entityId(name);
    this.db
      .query(
        "INSERT OR REPLACE INTO entities (id, name, type, properties) VALUES (?, ?, ?, ?)",
      )
      .run(id, name, entityType, JSON.stringify(properties ?? {}));
    return id;
  }

  addTriple(
    subject: string,
    predicate: string,
    object: string,
    validFrom: string | null = null,
    validTo: string | null = null,
    confidence = 1.0,
    sourceCloset: string | null = null,
    sourceFile: string | null = null,
  ): string {
    const subjectId = this.entityId(subject);
    const objectId = this.entityId(object);
    const normalizedPredicate = predicate.toLowerCase().replaceAll(" ", "_");

    this.db
      .query("INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)")
      .run(subjectId, subject);
    this.db
      .query("INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)")
      .run(objectId, object);

    const existing = this.db
      .query<{ id: string }, [string, string, string]>(
        "SELECT id FROM triples WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL",
      )
      .get(subjectId, normalizedPredicate, objectId);

    if (existing) {
      return existing.id;
    }

    const hash = createHash("md5")
      .update(`${validFrom ?? "null"}${new Date().toISOString()}`)
      .digest("hex")
      .slice(0, 8);
    const tripleId = `t_${subjectId}_${normalizedPredicate}_${objectId}_${hash}`;

    this.db
      .query(
        `INSERT INTO triples (
          id, subject, predicate, object, valid_from, valid_to, confidence, source_closet, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tripleId,
        subjectId,
        normalizedPredicate,
        objectId,
        validFrom,
        validTo,
        confidence,
        sourceCloset,
        sourceFile,
      );

    return tripleId;
  }

  invalidateTriple(
    subject: string,
    predicate: string,
    object: string,
    ended: string | null = null,
  ): void {
    const subjectId = this.entityId(subject);
    const objectId = this.entityId(object);
    const normalizedPredicate = predicate.toLowerCase().replaceAll(" ", "_");
    const endedAt = ended ?? new Date().toISOString().slice(0, 10);

    this.db
      .query(
        "UPDATE triples SET valid_to = ? WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL",
      )
      .run(endedAt, subjectId, normalizedPredicate, objectId);
  }

  queryEntity(
    name: string,
    asOf: string | null = null,
    direction: "outgoing" | "incoming" | "both" = "outgoing",
  ): QueryResult[] {
    const entityId = this.entityId(name);
    const results: QueryResult[] = [];

    if (direction === "outgoing" || direction === "both") {
      let query = `
        SELECT
          t.predicate,
          t.valid_from,
          t.valid_to,
          t.confidence,
          t.source_closet,
          e.name AS related_name
        FROM triples t
        JOIN entities e ON t.object = e.id
        WHERE t.subject = ?
      `;
      const params: [string, ...string[]] = [entityId];
      if (asOf) {
        query += " AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)";
        params.push(asOf, asOf);
      }

      for (const row of this.db.query<QueryEntityRow, [string, ...string[]]>(query).all(...params)) {
        results.push({
          direction: "outgoing",
          subject: name,
          predicate: row.predicate,
          object: row.related_name,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          confidence: row.confidence,
          sourceCloset: row.source_closet,
          current: row.valid_to === null,
        });
      }
    }

    if (direction === "incoming" || direction === "both") {
      let query = `
        SELECT
          t.predicate,
          t.valid_from,
          t.valid_to,
          t.confidence,
          t.source_closet,
          e.name AS related_name
        FROM triples t
        JOIN entities e ON t.subject = e.id
        WHERE t.object = ?
      `;
      const params: [string, ...string[]] = [entityId];
      if (asOf) {
        query += " AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)";
        params.push(asOf, asOf);
      }

      for (const row of this.db.query<QueryEntityRow, [string, ...string[]]>(query).all(...params)) {
        results.push({
          direction: "incoming",
          subject: row.related_name,
          predicate: row.predicate,
          object: name,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          confidence: row.confidence,
          sourceCloset: row.source_closet,
          current: row.valid_to === null,
        });
      }
    }

    return results;
  }

  queryRelationship(predicate: string, asOf: string | null = null): QueryResult[] {
    const normalizedPredicate = predicate.toLowerCase().replaceAll(" ", "_");
    let query = `
      SELECT
        t.valid_from,
        t.valid_to,
        s.name AS sub_name,
        o.name AS obj_name
      FROM triples t
      JOIN entities s ON t.subject = s.id
      JOIN entities o ON t.object = o.id
      WHERE t.predicate = ?
    `;
    const params: [string, ...string[]] = [normalizedPredicate];

    if (asOf) {
      query += " AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)";
      params.push(asOf, asOf);
    }

    return this.db
      .query<Pick<TimelineRow, "valid_from" | "valid_to" | "sub_name" | "obj_name">, [string, ...string[]]>(query)
      .all(...params)
      .map((row) => ({
        subject: row.sub_name,
        predicate: normalizedPredicate,
        object: row.obj_name,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        current: row.valid_to === null,
      }));
  }

  getTimeline(entityName?: string | null): QueryResult[] {
    if (entityName) {
      const entityId = this.entityId(entityName);
      return this.db
        .query<TimelineRow, [string, string]>(`
          SELECT
            t.predicate,
            t.valid_from,
            t.valid_to,
            s.name AS sub_name,
            o.name AS obj_name
          FROM triples t
          JOIN entities s ON t.subject = s.id
          JOIN entities o ON t.object = o.id
          WHERE (t.subject = ? OR t.object = ?)
          ORDER BY t.valid_from IS NULL, t.valid_from ASC
        `)
        .all(entityId, entityId)
        .map((row) => ({
          subject: row.sub_name,
          predicate: row.predicate,
          object: row.obj_name,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          current: row.valid_to === null,
        }));
    }

    return this.db
      .query<TimelineRow, []>(`
        SELECT
          t.predicate,
          t.valid_from,
          t.valid_to,
          s.name AS sub_name,
          o.name AS obj_name
        FROM triples t
        JOIN entities s ON t.subject = s.id
        JOIN entities o ON t.object = o.id
        ORDER BY t.valid_from IS NULL, t.valid_from ASC
        LIMIT 100
      `)
      .all()
      .map((row) => ({
        subject: row.sub_name,
        predicate: row.predicate,
        object: row.obj_name,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        current: row.valid_to === null,
      }));
  }

  getStats(): StatsResult {
    const entities = this.db.query<CountRow, []>("SELECT COUNT(*) AS count FROM entities").get()?.count ?? 0;
    const triples = this.db.query<CountRow, []>("SELECT COUNT(*) AS count FROM triples").get()?.count ?? 0;
    const currentFacts =
      this.db.query<CountRow, []>("SELECT COUNT(*) AS count FROM triples WHERE valid_to IS NULL").get()?.count ?? 0;
    const relationshipTypes = this.db
      .query<PredicateRow, []>("SELECT DISTINCT predicate FROM triples ORDER BY predicate")
      .all()
      .map((row) => row.predicate);

    return {
      entities,
      triples,
      currentFacts,
      expiredFacts: triples - currentFacts,
      relationshipTypes,
    };
  }

  seedFromEntityFacts(entityFacts: Record<string, EntityFact>): void {
    for (const [key, facts] of Object.entries(entityFacts)) {
      const name = facts.full_name ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      const entityType = facts.type ?? "person";

      this.addEntity(name, entityType, {
        gender: facts.gender ?? "",
        birthday: facts.birthday ?? "",
      });

      const parent = facts.parent;
      if (parent) {
        this.addTriple(name, "child_of", capitalize(parent), facts.birthday ?? null);
      }

      const partner = facts.partner;
      if (partner) {
        this.addTriple(name, "married_to", capitalize(partner));
      }

      const relationship = facts.relationship ?? "";
      if (relationship === "daughter") {
        this.addTriple(
          name,
          "is_child_of",
          capitalize(facts.parent ?? "") || name,
          facts.birthday ?? null,
        );
      } else if (relationship === "husband") {
        this.addTriple(name, "is_partner_of", capitalize(facts.partner ?? name));
      } else if (relationship === "brother") {
        this.addTriple(name, "is_sibling_of", capitalize(facts.sibling ?? name));
      } else if (relationship === "dog") {
        this.addTriple(name, "is_pet_of", capitalize(facts.owner ?? name));
        this.addEntity(name, "animal");
      }

      for (const interest of facts.interests ?? []) {
        this.addTriple(name, "loves", capitalize(interest), "2025-01-01");
      }
    }
  }

  close(): void {
    this.db.close();
  }
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

export default KnowledgeGraph;
