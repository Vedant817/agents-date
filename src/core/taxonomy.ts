/**
 * Canonical trait taxonomy.
 *
 * Two people can only be compared if their words collapse onto shared keys.
 * Each entry lists surface forms we look for in LinkedIn/Instagram text; the
 * analyser maps any match onto the same canonical key so that "trail running"
 * and "trail runs" compare as one hobby.
 */

export interface TraitDefinition {
  readonly key: string;
  readonly label: string;
  readonly category: "interest" | "hobby" | "value" | "skill" | "context";
  /** Lowercase surface forms. Phrases are matched before single words. */
  readonly forms: readonly string[];
  /**
   * Two agents are more likely to enjoy a date doing the same thing. Used to
   * weight shared-ground scoring so that e.g. two runners outrank a runner and
   * a reader even if both profiles mention "outdoors".
   */
  readonly affinity?: number;
}

export const TRAITS: readonly TraitDefinition[] = [
  // --- Outdoor & sport -----------------------------------------------------
  { key: "hobby:trail-running", label: "Trail running", category: "hobby", forms: ["trail running", "trail runs", "ultra running", "trailrunner", "running"], affinity: 0.9 },
  { key: "hobby:running", label: "Running", category: "hobby", forms: ["running", "jogging", "marathon", "10k", "half marathon"], affinity: 0.85 },
  { key: "hobby:cycling", label: "Cycling", category: "hobby", forms: ["cycling", "biking", "bike rides", "gravel ride", "cyclocross"], affinity: 0.8 },
  { key: "hobby:climbing", label: "Climbing", category: "hobby", forms: ["climbing", "bouldering", "sport climbing", "top rope"], affinity: 0.75 },
  { key: "hobby:surfing", label: "Surfing", category: "hobby", forms: ["surfing", "surf", "paddling", "sup"], affinity: 0.7 },
  { key: "hobby:hiking", label: "Hiking", category: "hobby", forms: ["hiking", "trekking", "day hikes", "backpacking", "mountaineering"], affinity: 0.85 },
  { key: "hobby:skiing", label: "Skiing", category: "hobby", forms: ["skiing", "ski", "snowboarding", "boarding"], affinity: 0.7 },
  { key: "hobby:swimming", label: "Swimming", category: "hobby", forms: ["swimming", "open water", "laps"], affinity: 0.7 },
  { key: "hobby:tennis", label: "Tennis", category: "hobby", forms: ["tennis", "pickleball", "padel"], affinity: 0.7 },
  { key: "hobby:football", label: "Football", category: "hobby", forms: ["football", "soccer", "5-a-side", "futsal"], affinity: 0.65 },
  { key: "hobby:badminton", label: "Badminton", category: "hobby", forms: ["badminton", "table tennis"], affinity: 0.6 },
  { key: "hobby:golf", label: "Golf", category: "hobby", forms: ["golf", "golfing"], affinity: 0.6 },
  { key: "hobby:yoga", label: "Yoga", category: "hobby", forms: ["yoga", "vinyasa", "pilates", "stretching"], affinity: 0.65 },

  // --- Creative ------------------------------------------------------------
  { key: "hobby:photography", label: "Photography", category: "hobby", forms: ["photography", "photographer", "shooting photos", "film camera"], affinity: 0.75 },
  { key: "hobby:painting", label: "Painting", category: "hobby", forms: ["painting", "painter", "watercolours", "watercolors", "sketching"], affinity: 0.65 },
  { key: "hobby:writing", label: "Writing", category: "hobby", forms: ["writing", "writer", "short stories", "novel", "screenwriting", "blogging"], affinity: 0.7 },
  { key: "hobby:music", label: "Music", category: "hobby", forms: ["music", "guitar", "piano", "dj", "vinyl", "band", "producing music"], affinity: 0.7 },
  { key: "hobby:cooking", label: "Cooking", category: "hobby", forms: ["cooking", "cook", "baking", "sourdough", "recipes", "fermentation"], affinity: 0.7 },
  { key: "hobby:gardening", label: "Gardening", category: "hobby", forms: ["gardening", "plants", "allotment", "houseplants"], affinity: 0.55 },
  { key: "hobby:woodworking", label: "Woodworking", category: "hobby", forms: ["woodworking", "carpentry", "joinery"], affinity: 0.5 },
  { key: "hobby:throwing-pottery", label: "Pottery", category: "hobby", forms: ["pottery", "ceramics", "wheel throwing"], affinity: 0.5 },

  // --- Food & drink --------------------------------------------------------
  { key: "interest:coffee", label: "Coffee", category: "interest", forms: ["coffee", "espresso", "specialty coffee", "cafe", "barista"], affinity: 0.8 },
  { key: "interest:wine", label: "Wine", category: "interest", forms: ["wine", "natural wine", "sommelier", "winery"], affinity: 0.75 },
  { key: "interest:craft-beer", label: "Craft beer", category: "interest", forms: ["craft beer", "beer", "brewery", "tapping", "stout", "ipa"], affinity: 0.7 },
  { key: "interest:food", label: "Food", category: "interest", forms: ["food", "restaurants", "street food", "foodie", "brunch"], affinity: 0.6 },
  { key: "interest:tea", label: "Tea", category: "interest", forms: ["tea", "matcha", "loose leaf"], affinity: 0.6 },

  // --- Culture & media -----------------------------------------------------
  { key: "interest:live-music", label: "Live music", category: "interest", forms: ["live music", "concerts", "gigs", "festivals", "gigging"], affinity: 0.75 },
  { key: "interest:film", label: "Film", category: "interest", forms: ["film", "cinema", "movie", "a24", "arthouse"], affinity: 0.7 },
  { key: "interest:books", label: "Books", category: "interest", forms: ["books", "reading", "novels", "book club", "literature"], affinity: 0.7 },
  { key: "interest:art-galleries", label: "Art galleries", category: "interest", forms: ["gallery", "galleries", "exhibition", "museum", "modern art"], affinity: 0.65 },
  { key: "interest:theatre", label: "Theatre", category: "interest", forms: ["theatre", "theater", "plays", "musicals", "stand-up comedy"], affinity: 0.65 },
  { key: "interest:comics", label: "Comics & anime", category: "interest", forms: ["comics", "anime", "manga", "graphic novel"], affinity: 0.6 },
  { key: "interest:board-games", label: "Board games", category: "interest", forms: ["board games", "chess", "puzzles", "escape room"], affinity: 0.6 },

  // --- Outward-looking -----------------------------------------------------
  { key: "value:volunteering", label: "Volunteering", category: "value", forms: ["volunteer", "volunteering", "charity", "nonprofit", "non-profit", "community work"], affinity: 0.7 },
  { key: "value:sustainability", label: "Sustainability", category: "value", forms: ["sustainability", "sustainable", "climate", "renewable", "net zero", "recycling"], affinity: 0.65 },
  { key: "value:diversity", label: "Inclusion", category: "value", forms: ["diversity", "inclusion", "dei", "accessibility", "equity"], affinity: 0.65 },
  { key: "value:mentorship", label: "Mentorship", category: "value", forms: ["mentoring", "mentorship", "coaching", "mentee"], affinity: 0.7 },
  { key: "value:community-building", label: "Community building", category: "value", forms: ["community", "organising", "organizing", "meetups", "events", "founders"], affinity: 0.65 },

  // --- Ways of spending time ------------------------------------------------
  { key: "interest:travel", label: "Travel", category: "interest", forms: ["travel", "travelling", "traveling", "backpacking", "road trip"], affinity: 0.6 },
  { key: "interest:cooking-together", label: "Cooking for people", category: "interest", forms: ["hosting", "dinner parties", "cooking for friends"], affinity: 0.6 },
  { key: "interest:dogs", label: "Dogs", category: "interest", forms: ["dog", "dogs", "rescue", "puppy", "hound"], affinity: 0.6 },
  { key: "interest:cats", label: "Cats", category: "interest", forms: ["cat", "cats", "kitten"], affinity: 0.55 },
  { key: "interest:running-clubs", label: "Running club", category: "interest", forms: ["parkrun", "run club", "running club"], affinity: 0.7 },
] as const;

const INDEX: ReadonlyMap<string, TraitDefinition> = new Map(
  TRAITS.filter((t): t is TraitDefinition => Boolean(t?.key)).map((t) => [t.key, t]),
);

/** Longest forms first so "trail running" wins over "running". */
const SORTED: readonly { def: TraitDefinition; form: string }[] = TRAITS.filter(
  (t): t is TraitDefinition => Boolean(t?.key),
)
  .flatMap((def) => def.forms.map((form) => ({ def, form })))
  .sort((a, b) => b.form.length - a.form.length);

export function getTrait(key: string): TraitDefinition | undefined {
  return INDEX.get(key);
}

/** Every canonical key, for the UI to explain the scoring model. */
export function allTraitKeys(): readonly string[] {
  return [...INDEX.keys()];
}

/**
 * Find taxonomy hits in a line of text.
 *
 * Word-boundary matching only. Without it, "art" would fire inside "start",
 * and "ipa" inside "participate", producing confident nonsense -- the exact
 * failure mode that makes an analysis feel made up.
 */
export function matchLine(
  line: string,
): { def: TraitDefinition; matchedForm: string }[] {
  const haystack = ` ${line.toLowerCase().replace(/[^a-z0-9\s+]/g, " ")} `;
  const hits: { def: TraitDefinition; matchedForm: string }[] = [];
  const seen = new Set<string>();

  for (const { def, form } of SORTED) {
    if (seen.has(def.key)) continue;
    const needle = ` ${form.toLowerCase().replace(/[^a-z0-9\s+]/g, " ")} `;
    if (haystack.includes(needle)) {
      seen.add(def.key);
      hits.push({ def, matchedForm: form });
    }
  }
  return hits;
}
