import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import yaml from "js-yaml";
import { scanProject } from "./miner";

export type Room = {
	name: string;
	description: string;
	keywords: string[];
};

export const FOLDER_ROOM_MAP: Record<string, string> = {
	frontend: "frontend",
	"front-end": "frontend",
	front_end: "frontend",
	client: "frontend",
	ui: "frontend",
	views: "frontend",
	components: "frontend",
	pages: "frontend",
	backend: "backend",
	"back-end": "backend",
	back_end: "backend",
	server: "backend",
	api: "backend",
	routes: "backend",
	services: "backend",
	controllers: "backend",
	models: "backend",
	database: "backend",
	db: "backend",
	docs: "documentation",
	doc: "documentation",
	documentation: "documentation",
	wiki: "documentation",
	readme: "documentation",
	notes: "documentation",
	design: "design",
	designs: "design",
	mockups: "design",
	wireframes: "design",
	assets: "design",
	storyboard: "design",
	costs: "costs",
	cost: "costs",
	budget: "costs",
	finance: "costs",
	financial: "costs",
	pricing: "costs",
	invoices: "costs",
	accounting: "costs",
	meetings: "meetings",
	meeting: "meetings",
	calls: "meetings",
	meeting_notes: "meetings",
	standup: "meetings",
	minutes: "meetings",
	team: "team",
	staff: "team",
	hr: "team",
	hiring: "team",
	employees: "team",
	people: "team",
	research: "research",
	references: "research",
	reading: "research",
	papers: "research",
	planning: "planning",
	roadmap: "planning",
	strategy: "planning",
	specs: "planning",
	requirements: "planning",
	tests: "testing",
	test: "testing",
	testing: "testing",
	qa: "testing",
	scripts: "scripts",
	tools: "scripts",
	utils: "scripts",
	config: "configuration",
	configs: "configuration",
	settings: "configuration",
	infrastructure: "configuration",
	infra: "configuration",
	deploy: "configuration",
};

const SKIP_DIRS = new Set([
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
]);

const FILE_FALLBACK_SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"__pycache__",
	".venv",
	"venv",
	"dist",
	"build",
]);

function normalizeName(value: string): string {
	return value.toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
}

function formatRule(char: string, width = 55): string {
	return char.repeat(width);
}

function ensureNotCancelled<T>(value: T): T {
	if (isCancel(value)) {
		cancel("Operation cancelled.");
		process.exit(1);
	}

	return value;
}

async function promptText(message: string, placeholder?: string, initialValue?: string): Promise<string> {
	return ensureNotCancelled(
		await text({
			message,
			placeholder,
			initialValue,
		}),
	) as string;
}

async function promptConfirm(message: string, initialValue = false): Promise<boolean> {
	return ensureNotCancelled(
		await confirm({
			message,
			initialValue,
		}),
	) as boolean;
}

async function promptChoice(): Promise<"accept" | "edit" | "add"> {
	return ensureNotCancelled(
		await select<"accept" | "edit" | "add">({
			message: "Choose how to proceed",
			options: [
				{ value: "accept", label: "Accept all rooms" },
				{ value: "edit", label: "Edit existing rooms" },
				{ value: "add", label: "Add rooms manually" },
			],
		}),
	) as "accept" | "edit" | "add";
}

function buildRoom(name: string, description: string, keywords: string[]): Room {
	return { name, description, keywords };
}

export function detectRoomsFromFolders(projectDir: string): Room[] {
	const projectPath = resolve(projectDir);
	const foundRooms = new Map<string, string>();

	for (const item of readdirSync(projectPath, { withFileTypes: true })) {
		if (!item.isDirectory() || SKIP_DIRS.has(item.name)) {
			continue;
		}

		const normalized = item.name.toLowerCase().replace(/-/g, "_");
		const mappedRoom = FOLDER_ROOM_MAP[normalized];
		if (mappedRoom) {
			if (!foundRooms.has(mappedRoom)) {
				foundRooms.set(mappedRoom, item.name);
			}
			continue;
		}

		if (item.name.length > 2 && /^[A-Za-z]/.test(item.name)) {
			const clean = normalizeName(item.name);
			if (!foundRooms.has(clean)) {
				foundRooms.set(clean, item.name);
			}
		}
	}

	for (const item of readdirSync(projectPath, { withFileTypes: true })) {
		if (!item.isDirectory() || SKIP_DIRS.has(item.name)) {
			continue;
		}

		const itemPath = resolve(projectPath, item.name);
		for (const subitem of readdirSync(itemPath, { withFileTypes: true })) {
			if (!subitem.isDirectory() || SKIP_DIRS.has(subitem.name)) {
				continue;
			}

			const normalized = subitem.name.toLowerCase().replace(/-/g, "_");
			const mappedRoom = FOLDER_ROOM_MAP[normalized];
			if (mappedRoom && !foundRooms.has(mappedRoom)) {
				foundRooms.set(mappedRoom, subitem.name);
			}
		}
	}

	const rooms = Array.from(foundRooms.entries(), ([roomName, original]) =>
		buildRoom(roomName, `Files from ${original}/`, [roomName, original.toLowerCase()]),
	);

	if (!rooms.some((room) => room.name === "general")) {
		rooms.push(buildRoom("general", "Files that don't fit other rooms", []));
	}

	return rooms;
}

export function detectRoomsFromFiles(projectDir: string): Room[] {
	const projectPath = resolve(projectDir);
	const keywordCounts = new Map<string, number>();

	const walk = (currentDir: string): void => {
		for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
			const entryPath = resolve(currentDir, entry.name);

			if (entry.isDirectory()) {
				if (!FILE_FALLBACK_SKIP_DIRS.has(entry.name)) {
					walk(entryPath);
				}
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			const normalizedName = normalizeName(entry.name);
			for (const [keyword, room] of Object.entries(FOLDER_ROOM_MAP)) {
				if (normalizedName.includes(keyword)) {
					keywordCounts.set(room, (keywordCounts.get(room) ?? 0) + 1);
				}
			}
		}
	};

	walk(projectPath);

	const rooms: Room[] = [];
	for (const [room, count] of [...keywordCounts.entries()].sort((left, right) => right[1] - left[1])) {
		if (count >= 2) {
			rooms.push(buildRoom(room, `Files related to ${room}`, [room]));
		}

		if (rooms.length >= 6) {
			break;
		}
	}

	if (rooms.length === 0) {
		return [buildRoom("general", "All project files", [])];
	}

	return rooms;
}

function printProposedStructure(projectName: string, rooms: Room[], totalFiles: number, source: string): void {
	console.log(`\n${formatRule("=")}`);
	console.log("  MemPalace Init — Local setup");
	console.log(formatRule("="));
	console.log(`\n  WING: ${projectName}`);
	console.log(`  (${totalFiles} files found, rooms detected from ${source})\n`);
	for (const room of rooms) {
		console.log(`    ROOM: ${room.name}`);
		console.log(`          ${room.description}`);
	}
	console.log(`\n${formatRule("─")}\n`);
}

async function getUserApproval(rooms: Room[]): Promise<Room[]> {
	console.log("  Review the proposed rooms above.");

	const choice = await promptChoice();

	let nextRooms = [...rooms];

	if (choice === "edit") {
		console.log("\n  Current rooms:");
		nextRooms.forEach((room, index) => {
			console.log(`    ${index + 1}. ${room.name} — ${room.description}`);
		});

		const removeInput = await promptText(
			"Room numbers to remove (comma-separated, leave blank to skip)",
			"2,4",
		);

		if (removeInput.trim()) {
			const toRemove = new Set(
				removeInput
					.split(",")
					.map((value: string) => Number.parseInt(value.trim(), 10) - 1)
					.filter((value: number) => Number.isInteger(value) && value >= 0),
			);
			nextRooms = nextRooms.filter((_, index) => !toRemove.has(index));
		}

		if (nextRooms.length > 0) {
			const shouldRename = await promptConfirm("Rename any remaining rooms?");

			if (shouldRename) {
				const renamedRooms: Room[] = [];
				for (const room of nextRooms) {
					const newName = await promptText(
						`Rename '${room.name}' (leave blank to keep)`,
						room.name,
					);

					const trimmedName = newName.trim();
					if (!trimmedName) {
						renamedRooms.push(room);
						continue;
					}

					const normalizedRoomName = normalizeName(trimmedName);
					const newDescription = await promptText(
						`Description for '${normalizedRoomName}'`,
						undefined,
						room.description,
					);

					renamedRooms.push(
						buildRoom(normalizedRoomName, newDescription.trim() || room.description, [normalizedRoomName]),
					);
				}

				nextRooms = renamedRooms;
			}
		}
	}

	const wantsAdd = choice === "add";
	if (wantsAdd || (await promptConfirm("Add any missing rooms?", wantsAdd))) {
		while (true) {
			const newName = await promptText(
				"New room name (leave blank to stop)",
				"research_notes",
			);

			const normalizedRoomName = normalizeName(newName.trim());
			if (!normalizedRoomName) {
				break;
			}

			const newDescription = await promptText(`Description for '${normalizedRoomName}'`);

			nextRooms.push(buildRoom(normalizedRoomName, newDescription.trim(), [normalizedRoomName]));
			console.log(`  Added: ${normalizedRoomName}`);
		}
	}

	return nextRooms;
}

export function saveConfig(projectDir: string, projectName: string, rooms: Room[]): void {
	const config = {
		wing: projectName,
		rooms: rooms.map((room) => ({
			name: room.name,
			description: room.description,
		})),
	};
	const configPath = resolve(projectDir, "mempalace.yaml");
	writeFileSync(configPath, yaml.dump(config), "utf-8");

	console.log(`\n  Config saved: ${configPath}`);
	console.log("\n  Next step:");
	console.log(`    mempalace mine ${projectDir}`);
	console.log(`\n${formatRule("=")}\n`);
}

export async function detectRoomsLocal(projectDir: string): Promise<void> {
	const projectPath = resolve(projectDir);
	const projectName = basename(projectPath).toLowerCase().replace(/ /g, "_").replace(/-/g, "_");

	try {
		if (!statSync(projectPath).isDirectory()) {
			throw new Error("Not a directory");
		}
	} catch {
		console.log(`ERROR: Directory not found: ${projectDir}`);
		process.exit(1);
	}

	const files = scanProject(projectDir);

	let rooms = detectRoomsFromFolders(projectDir);
	let source = "folder structure";

	if (rooms.length <= 1) {
		rooms = detectRoomsFromFiles(projectDir);
		source = "filename patterns";
	}

	if (rooms.length === 0) {
		rooms = [buildRoom("general", "All project files", [])];
		source = "fallback (flat project)";
	}

	printProposedStructure(projectName, rooms, files.length, source);
	const approvedRooms = await getUserApproval(rooms);
	saveConfig(projectDir, projectName, approvedRooms);
}
