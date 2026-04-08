import { ChromaClient } from "chromadb";
import { MempalaceConfig } from "./config";

export interface Node {
  wings: string[];
  halls: string[];
  count: number;
  dates: string[];
}

export interface Edge {
  room: string;
  wing_a: string;
  wing_b: string;
  hall: string;
  count: number;
}

export interface Graph {
  nodes: Record<string, Node>;
  edges: Edge[];
}

type ChromaCollection = {
  count: () => Promise<number>;
  get: (args: {
    limit: number;
    offset: number;
    include: string[];
  }) => Promise<{
    metadatas?: Array<Record<string, unknown> | null>;
    ids?: string[];
  }>;
};

export async function getCollection(
  config: MempalaceConfig = new MempalaceConfig(),
): Promise<ChromaCollection | null> {
  try {
    const client = new ChromaClient({ path: config.chromaUrl });
    return (await client.getCollection({
      name: config.collectionName,
      embeddingFunction: undefined as any,
    })) as ChromaCollection;
  } catch {
    return null;
  }
}

export async function buildGraph(
  col: ChromaCollection | null = null,
  config: MempalaceConfig = new MempalaceConfig(),
): Promise<[Record<string, Node>, Edge[]]> {
  if (col === null) {
    col = await getCollection(config);
  }
  if (!col) {
    return [{}, []];
  }

  const total = await col.count();
  const roomData: Record<
    string,
    { wings: Set<string>; halls: Set<string>; count: number; dates: Set<string> }
  > = {};

  let offset = 0;
  while (offset < total) {
    const batch = await col.get({ limit: 1000, offset, include: ["metadatas"] });
    for (const meta of batch.metadatas ?? []) {
      if (!meta) continue;
      const room = String(meta.room ?? "");
      const wing = String(meta.wing ?? "");
      const hall = String(meta.hall ?? "");
      const date = String(meta.date ?? "");

      if (room && room !== "general" && wing) {
        roomData[room] ??= {
          wings: new Set<string>(),
          halls: new Set<string>(),
          count: 0,
          dates: new Set<string>(),
        };

        roomData[room].wings.add(wing);
        if (hall) roomData[room].halls.add(hall);
        if (date) roomData[room].dates.add(date);
        roomData[room].count += 1;
      }
    }

    if (!batch.ids || batch.ids.length === 0) {
      break;
    }
    offset += batch.ids.length;
  }

  const edges: Edge[] = [];
  for (const [room, data] of Object.entries(roomData)) {
    const wings = [...data.wings].sort();
    if (wings.length >= 2) {
      for (let i = 0; i < wings.length; i += 1) {
        const wa = wings[i];
        for (let j = i + 1; j < wings.length; j += 1) {
          const wb = wings[j];
          for (const hall of data.halls) {
            edges.push({
              room,
              wing_a: wa,
              wing_b: wb,
              hall,
              count: data.count,
            });
          }
        }
      }
    }
  }

  const nodes: Record<string, Node> = {};
  for (const [room, data] of Object.entries(roomData)) {
    const dates = [...data.dates].sort();
    nodes[room] = {
      wings: [...data.wings].sort(),
      halls: [...data.halls].sort(),
      count: data.count,
      dates: dates.length ? dates.slice(-5) : [],
    };
  }

  return [nodes, edges];
}

export async function traverse(
  startRoom: string,
  col: ChromaCollection | null = null,
  config: MempalaceConfig = new MempalaceConfig(),
  maxHops = 2,
): Promise<
  | Array<{
      room: string;
      wings: string[];
      halls: string[];
      count: number;
      hop: number;
      connected_via?: string[];
    }>
  | { error: string; suggestions: string[] }
> {
  const [nodes] = await buildGraph(col, config);

  if (!(startRoom in nodes)) {
    return {
      error: `Room '${startRoom}' not found`,
      suggestions: fuzzyMatch(startRoom, nodes),
    };
  }

  const start = nodes[startRoom];
  const visited = new Set<string>([startRoom]);
  const results: Array<{
    room: string;
    wings: string[];
    halls: string[];
    count: number;
    hop: number;
    connected_via?: string[];
  }> = [
    {
      room: startRoom,
      wings: start.wings,
      halls: start.halls,
      count: start.count,
      hop: 0,
    },
  ];

  const frontier: Array<[string, number]> = [[startRoom, 0]];
  while (frontier.length > 0) {
    const [currentRoom, depth] = frontier.shift() as [string, number];
    if (depth >= maxHops) {
      continue;
    }

    const current = nodes[currentRoom] ?? { wings: [], halls: [], count: 0, dates: [] };
    const currentWings = new Set(current.wings);

    for (const [room, data] of Object.entries(nodes)) {
      if (visited.has(room)) {
        continue;
      }

      const sharedWings = intersectSets(currentWings, new Set(data.wings));
      if (sharedWings.length > 0) {
        visited.add(room);
        results.push({
          room,
          wings: data.wings,
          halls: data.halls,
          count: data.count,
          hop: depth + 1,
          connected_via: sharedWings.sort(),
        });

        if (depth + 1 < maxHops) {
          frontier.push([room, depth + 1]);
        }
      }
    }
  }

  results.sort((a, b) => a.hop - b.hop || b.count - a.count);
  return results.slice(0, 50);
}

export async function findTunnels(
  wingA: string | null = null,
  wingB: string | null = null,
  col: ChromaCollection | null = null,
  config: MempalaceConfig = new MempalaceConfig(),
): Promise<Array<{ room: string; wings: string[]; halls: string[]; count: number; recent: string }>> {
  const [nodes] = await buildGraph(col, config);

  const tunnels: Array<{ room: string; wings: string[]; halls: string[]; count: number; recent: string }> = [];
  for (const [room, data] of Object.entries(nodes)) {
    const wings = data.wings;
    if (wings.length < 2) {
      continue;
    }
    if (wingA && !wings.includes(wingA)) {
      continue;
    }
    if (wingB && !wings.includes(wingB)) {
      continue;
    }

    tunnels.push({
      room,
      wings,
      halls: data.halls,
      count: data.count,
      recent: data.dates.length ? data.dates[data.dates.length - 1] : "",
    });
  }

  tunnels.sort((a, b) => b.count - a.count);
  return tunnels.slice(0, 50);
}

export async function graphStats(
  col: ChromaCollection | null = null,
  config: MempalaceConfig = new MempalaceConfig(),
): Promise<{
  total_rooms: number;
  tunnel_rooms: number;
  total_edges: number;
  rooms_per_wing: Record<string, number>;
  top_tunnels: Array<{ room: string; wings: string[]; count: number }>;
}> {
  const [nodes, edges] = await buildGraph(col, config);

  let tunnelRooms = 0;
  const wingCounts = new Map<string, number>();
  for (const data of Object.values(nodes)) {
    if (data.wings.length >= 2) {
      tunnelRooms += 1;
    }
    for (const wing of data.wings) {
      wingCounts.set(wing, (wingCounts.get(wing) ?? 0) + 1);
    }
  }

  return {
    total_rooms: Object.keys(nodes).length,
    tunnel_rooms: tunnelRooms,
    total_edges: edges.length,
    rooms_per_wing: Object.fromEntries([...wingCounts.entries()].sort((a, b) => b[1] - a[1])),
    top_tunnels: Object.entries(nodes)
      .sort((a, b) => b[1].wings.length - a[1].wings.length)
      .slice(0, 10)
      .filter(([, data]) => data.wings.length >= 2)
      .map(([room, data]) => ({ room, wings: data.wings, count: data.count })),
  };
}

function fuzzyMatch(query: string, nodes: Record<string, Node>, n = 5): string[] {
  const queryLower = query.toLowerCase();
  const scored: Array<[string, number]> = [];

  for (const room of Object.keys(nodes)) {
    if (queryLower.includes(room)) {
      scored.push([room, 1.0]);
    } else if (queryLower.split("-").some((word) => word && room.includes(word))) {
      scored.push([room, 0.5]);
    }
  }

  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, n).map(([room]) => room);
}

function intersectSets(left: Set<string>, right: Set<string>): string[] {
  const shared: string[] = [];
  for (const value of left) {
    if (right.has(value)) {
      shared.push(value);
    }
  }
  return shared;
}
