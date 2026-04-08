import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { ChromaClient, DefaultEmbeddingFunction, IncludeEnum } from "chromadb";
import yaml from "js-yaml";
import { MempalaceConfig } from "./config";

export const READABLE_EXTENSIONS = new Set([
	".txt",
	".md",
	".py",
	".js",
	".ts",
	".jsx",
	".tsx",
	".json",
	".yaml",
	".yml",
	".html",
	".css",
	".java",
	".go",
	".rs",
	".rb",
	".sh",
	".csv",
	".sql",
	".toml",
]);

export const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"__pycache__",
	".venv",
	"venv",
	"env",
	"dist",
	"build",
	".next",
	"coverage",
	".mempalace",
]);

export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 100;
export const MIN_CHUNK_SIZE = 50;

const COLLECTION_NAME = "mempalace_drawers";
const SKIP_FILES = new Set([
	"mempalace.yaml",
	"mempalace.yml",
	"mempal.yaml",
	"mempal.yml",
	".gitignore",
	"package-lock.json",
]);

type RoomConfig = {
	name: string;
	description?: string;
	keywords?: string[];
};

type LoadedConfig = {
	wing: string;
	rooms?: RoomConfig[];
};

type Chunk = {
	content: string;
	chunkIndex: number;
};

type MineOptions = {
	projectDir: string;
	palacePath: string;
	wingOverride?: string;
	agent?: string;
	limit?: number;
	dryRun?: boolean;
};

type DrawerCollection = Awaited<ReturnType<ChromaClient["getCollection"]>>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseRooms(value: unknown): RoomConfig[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const rooms: RoomConfig[] = [];
	for (const item of value) {
		if (!isRecord(item) || typeof item.name !== "string") {
			continue;
		}

		const keywords = Array.isArray(item.keywords)
			? item.keywords.filter(
					(keyword): keyword is string => typeof keyword === "string",
				)
			: undefined;

		rooms.push({
			name: item.name,
			description:
				typeof item.description === "string" ? item.description : undefined,
			keywords,
		});
	}

	return rooms;
}

function formatRule(char: string, width = 55): string {
	return char.repeat(width);
}

function normalizeMineArgs(
	projectDirOrOptions: string | MineOptions,
	palacePath?: string,
	wingOverride?: string,
	agent = "mempalace",
	limit = 0,
	dryRun = false,
): MineOptions {
	if (typeof projectDirOrOptions === "string") {
		if (typeof palacePath !== "string") {
			throw new Error("palacePath is required");
		}

		return {
			projectDir: projectDirOrOptions,
			palacePath,
			wingOverride,
			agent,
			limit,
			dryRun,
		};
	}

	return {
		projectDir: projectDirOrOptions.projectDir,
		palacePath: projectDirOrOptions.palacePath,
		wingOverride: projectDirOrOptions.wingOverride,
		agent: projectDirOrOptions.agent ?? "mempalace",
		limit: projectDirOrOptions.limit ?? 0,
		dryRun: projectDirOrOptions.dryRun ?? false,
	};
}

export function loadConfig(projectDir: string): LoadedConfig {
	const projectPath = resolve(projectDir);
	const configPath = `${projectPath}/mempalace.yaml`;
	const legacyPath = `${projectPath}/mempal.yaml`;

	let selectedPath = configPath;
	if (!existsSync(selectedPath)) {
		if (existsSync(legacyPath)) {
			selectedPath = legacyPath;
		} else {
			console.log(`ERROR: No mempalace.yaml found in ${projectDir}`);
			console.log(`Run: mempalace init ${projectDir}`);
			process.exit(1);
		}
	}

	const parsed = yaml.load(readFileSync(selectedPath, "utf-8"));
	if (!isRecord(parsed) || typeof parsed.wing !== "string") {
		throw new Error(`Invalid MemPalace config: ${selectedPath}`);
	}

	return {
		wing: parsed.wing,
		rooms: parseRooms(parsed.rooms),
	};
}

export function detectRoom(
	filepath: string,
	content: string,
	rooms: RoomConfig[],
	projectPath: string,
): string {
	const relativePath = relative(projectPath, filepath).toLowerCase();
	const filename = basename(filepath, extname(filepath)).toLowerCase();
	const contentLower = content.slice(0, 2000).toLowerCase();

	const pathParts = relativePath.replace(/\\/g, "/").split("/");
	for (const part of pathParts.slice(0, -1)) {
		for (const room of rooms) {
			const roomName = room.name.toLowerCase();
			if (roomName.includes(part) || part.includes(roomName)) {
				return room.name;
			}
		}
	}

	for (const room of rooms) {
		const roomName = room.name.toLowerCase();
		if (roomName.includes(filename) || filename.includes(roomName)) {
			return room.name;
		}
	}

	const scores = new Map<string, number>();
	for (const room of rooms) {
		const keywords = [...(room.keywords ?? []), room.name];
		for (const keyword of keywords) {
			const lowered = keyword.toLowerCase();
			let count = 0;
			let position = 0;

			while (true) {
				const index = contentLower.indexOf(lowered, position);
				if (index === -1) {
					break;
				}
				count += 1;
				position = index + lowered.length;
			}

			scores.set(room.name, (scores.get(room.name) ?? 0) + count);
		}
	}

	let bestRoom = "general";
	let bestScore = 0;
	for (const [roomName, score] of scores.entries()) {
		if (score > bestScore) {
			bestRoom = roomName;
			bestScore = score;
		}
	}

	return bestScore > 0 ? bestRoom : "general";
}

export function chunkText(content: string, _sourceFile: string): Chunk[] {
	const trimmed = content.trim();
	if (!trimmed) {
		return [];
	}

	const chunks: Chunk[] = [];
	let start = 0;
	let chunkIndex = 0;

	while (start < trimmed.length) {
		let end = Math.min(start + CHUNK_SIZE, trimmed.length);

		if (end < trimmed.length) {
			let newlinePos = trimmed.lastIndexOf("\n\n", end);
			if (
				newlinePos >= start &&
				newlinePos > start + Math.floor(CHUNK_SIZE / 2)
			) {
				end = newlinePos;
			} else {
				newlinePos = trimmed.lastIndexOf("\n", end);
				if (
					newlinePos >= start &&
					newlinePos > start + Math.floor(CHUNK_SIZE / 2)
				) {
					end = newlinePos;
				}
			}
		}

		const chunk = trimmed.slice(start, end).trim();
		if (chunk.length >= MIN_CHUNK_SIZE) {
			chunks.push({ content: chunk, chunkIndex });
			chunkIndex += 1;
		}

		start = end < trimmed.length ? end - CHUNK_OVERLAP : end;
	}

	return chunks;
}

export async function getCollection(
	palacePath: string,
): Promise<DrawerCollection> {
	mkdirSync(palacePath, { recursive: true });
	const client = new ChromaClient({ path: new MempalaceConfig().chromaUrl });
	return client.getOrCreateCollection({ name: COLLECTION_NAME });
}

export async function fileAlreadyMined(
	collection: DrawerCollection,
	sourceFile: string,
): Promise<boolean> {
	try {
		const results = await collection.get({
			where: { source_file: sourceFile },
			limit: 1,
		});
		return results.ids.length > 0;
	} catch {
		return false;
	}
}

export async function addDrawer(
	collection: DrawerCollection,
	wing: string,
	room: string,
	content: string,
	sourceFile: string,
	chunkIndex: number,
	agent: string,
): Promise<boolean> {
	const drawerId = `drawer_${wing}_${room}_${createHash("md5")
		.update(sourceFile + String(chunkIndex))
		.digest("hex")
		.slice(0, 16)}`;

	try {
		await collection.add({
			documents: [content],
			ids: [drawerId],
			metadatas: [
				{
					wing,
					room,
					source_file: sourceFile,
					chunk_index: chunkIndex,
					added_by: agent,
					filed_at: new Date().toISOString(),
				},
			],
		});
		return true;
	} catch (error) {
		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			if (message.includes("already exists") || message.includes("duplicate")) {
				return false;
			}
		}
		throw error;
	}
}

export async function processFile(
	filepath: string,
	projectPath: string,
	collection: DrawerCollection | null,
	wing: string,
	rooms: RoomConfig[],
	agent: string,
	dryRun: boolean,
): Promise<number> {
	const sourceFile = filepath;
	const activeCollection: DrawerCollection | null = collection;

	if (!dryRun) {
		if (activeCollection === null) {
			throw new Error("Collection is required when dryRun is false");
		}
		if (await fileAlreadyMined(activeCollection, sourceFile)) {
			return 0;
		}
	}

	let content: string;
	try {
		content = readFileSync(filepath, { encoding: "utf-8" });
	} catch {
		return 0;
	}

	content = content.trim();
	if (content.length < MIN_CHUNK_SIZE) {
		return 0;
	}

	const room = detectRoom(filepath, content, rooms, projectPath);
	const chunks = chunkText(content, sourceFile);

	if (dryRun) {
		console.log(
			`    [DRY RUN] ${basename(filepath)} → room:${room} (${chunks.length} drawers)`,
		);
		return chunks.length;
	}

	let drawersAdded = 0;
	for (const chunk of chunks) {
		if (activeCollection === null) {
			throw new Error("Collection is required when dryRun is false");
		}

		const added = await addDrawer(
			activeCollection,
			wing,
			room,
			chunk.content,
			sourceFile,
			chunk.chunkIndex,
			agent,
		);
		if (added) {
			drawersAdded += 1;
		}
	}

	return drawersAdded;
}

export function scanProject(projectDir: string): string[] {
	const projectPath = resolve(projectDir);
	const files: string[] = [];

	const walk = (currentDir: string) => {
		for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) {
					walk(`${currentDir}/${entry.name}`);
				}
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			const filepath = `${currentDir}/${entry.name}`;
			if (!READABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
				continue;
			}

			if (SKIP_FILES.has(entry.name)) {
				continue;
			}

			try {
				statSync(filepath);
				files.push(filepath);
			} catch {}
		}
	};

	walk(projectPath);
	return files;
}

export async function mine(
	projectDir: string,
	palacePath: string,
	wingOverride?: string,
	agent?: string,
	limit?: number,
	dryRun?: boolean,
): Promise<void>;
export async function mine(options: MineOptions): Promise<void>;
export async function mine(
	projectDirOrOptions: string | MineOptions,
	palacePath?: string,
	wingOverride?: string,
	agent = "mempalace",
	limit = 0,
	dryRun = false,
): Promise<void> {
	const options = normalizeMineArgs(
		projectDirOrOptions,
		palacePath,
		wingOverride,
		agent,
		limit,
		dryRun,
	);
	const projectPath = resolve(options.projectDir);
	const config = loadConfig(options.projectDir);

	const wing = options.wingOverride ?? config.wing;
	const rooms = config.rooms ?? [
		{ name: "general", description: "All project files" },
	];

	let files = scanProject(options.projectDir);
	if ((options.limit ?? 0) > 0) {
		files = files.slice(0, options.limit);
	}

	console.log(`\n${formatRule("=")}`);
	console.log("  MemPalace Mine");
	console.log(formatRule("="));
	console.log(`  Wing:    ${wing}`);
	console.log(`  Rooms:   ${rooms.map((room) => room.name).join(", ")}`);
	console.log(`  Files:   ${files.length}`);
	console.log(`  Palace:  ${options.palacePath}`);
	if (options.dryRun) {
		console.log("  DRY RUN — nothing will be filed");
	}
	console.log(`${formatRule("─")}\n`);

	const collection = options.dryRun
		? null
		: await getCollection(options.palacePath);

	let totalDrawers = 0;
	let filesSkipped = 0;
	const roomCounts = new Map<string, number>();

	for (const [index, filepath] of files.entries()) {
		const drawers = await processFile(
			filepath,
			projectPath,
			collection,
			wing,
			rooms,
			options.agent ?? "mempalace",
			options.dryRun ?? false,
		);

		if (drawers === 0 && !options.dryRun) {
			filesSkipped += 1;
		} else {
			totalDrawers += drawers;
			const room = detectRoom(filepath, "", rooms, projectPath);
			roomCounts.set(room, (roomCounts.get(room) ?? 0) + 1);

			if (!options.dryRun) {
				console.log(
					`  ✓ [${String(index + 1).padStart(4)}/${files.length}] ${basename(
						filepath,
					)
						.slice(0, 50)
						.padEnd(50)} +${drawers}`,
				);
			}
		}
	}

	console.log(`\n${formatRule("=")}`);
	console.log("  Done.");
	console.log(`  Files processed: ${files.length - filesSkipped}`);
	console.log(`  Files skipped (already filed): ${filesSkipped}`);
	console.log(`  Drawers filed: ${totalDrawers}`);
	console.log("\n  By room:");

	for (const [room, count] of [...roomCounts.entries()].sort(
		(left, right) => right[1] - left[1],
	)) {
		console.log(`    ${room.padEnd(20)} ${count} files`);
	}

	console.log('\n  Next: mempalace search "what you\'re looking for"');
	console.log(`${formatRule("=")}\n`);
}

export async function status(palacePath: string): Promise<void> {
	try {
		mkdirSync(palacePath, { recursive: true });
    const client = new ChromaClient({ path: new MempalaceConfig().chromaUrl });
    const collection = await client.getCollection({
      name: COLLECTION_NAME,
      embeddingFunction: new DefaultEmbeddingFunction(),
    });
		const result = await collection.get({
			limit: 10000,
			include: [IncludeEnum.Metadatas],
		});
		const metadatas = result.metadatas;

		const wingRooms = new Map<string, Map<string, number>>();
		for (const metadata of metadatas) {
			if (metadata === null) {
				continue;
			}

			const wing = String(metadata.wing ?? "?");
			const room = String(metadata.room ?? "?");
			const rooms = wingRooms.get(wing) ?? new Map<string, number>();
			rooms.set(room, (rooms.get(room) ?? 0) + 1);
			wingRooms.set(wing, rooms);
		}

		console.log(`\n${formatRule("=")}`);
		console.log(`  MemPalace Status — ${metadatas.length} drawers`);
		console.log(`${formatRule("=")}\n`);

		for (const [wing, rooms] of [...wingRooms.entries()].sort(
			([left], [right]) => left.localeCompare(right),
		)) {
			console.log(`  WING: ${wing}`);
			for (const [room, count] of [...rooms.entries()].sort(
				(left, right) => right[1] - left[1],
			)) {
				console.log(
					`    ROOM: ${room.padEnd(20)} ${String(count).padStart(5)} drawers`,
				);
			}
			console.log();
		}

		console.log(`${formatRule("=")}\n`);
	} catch {
		console.log(`\n  No palace found at ${palacePath}`);
		console.log("  Run: mempalace init <dir> then mempalace mine <dir>");
	}
}
