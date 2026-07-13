// Friendly default names for sessions whose spawner didn't pick one.
// Names are how sessions are referenced in the UI — deliberately NOT
// derived from the task prompt (a session's identity shouldn't change
// meaning because its task text was long, and two sessions on similar
// tasks shouldn't look like twins).

const ADJECTIVES = [
  "Amber",
  "Brisk",
  "Calm",
  "Clever",
  "Copper",
  "Crimson",
  "Deft",
  "Eager",
  "Golden",
  "Indigo",
  "Jade",
  "Keen",
  "Lively",
  "Lunar",
  "Mellow",
  "Nimble",
  "Onyx",
  "Quiet",
  "Rapid",
  "Scarlet",
  "Silver",
  "Swift",
  "Velvet",
  "Vivid",
];

const NOUNS = [
  "Badger",
  "Bearing",
  "Comet",
  "Condor",
  "Coyote",
  "Dynamo",
  "Falcon",
  "Fjord",
  "Gecko",
  "Harbor",
  "Heron",
  "Ibex",
  "Lantern",
  "Lynx",
  "Marmot",
  "Meadow",
  "Orbit",
  "Osprey",
  "Otter",
  "Pylon",
  "Quasar",
  "Raven",
  "Summit",
  "Wren",
];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

// `taken` is compared case-insensitively; collisions just retry, and after
// enough bad luck (24*24 combos, so ~never) a numeric suffix disambiguates.
export function generateSessionName(taken: Iterable<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
    if (!lower.has(name.toLowerCase())) return name;
  }
  let i = 2;
  while (lower.has(`agent ${i}`)) i++;
  return `Agent ${i}`;
}
