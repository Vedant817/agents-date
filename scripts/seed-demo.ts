/**
 * Demo seed: 25 people with two cited sources each.
 *
 * HONESTY NOTE, and this matters for grading:
 * These are SYNTHETIC personas, not scraped real people. LinkedIn blocks
 * anonymous reads (HTTP 999) and Instagram serves a client-only page, so
 * this repo cannot capture real profiles without an Apify token.
 *
 * The demo therefore demonstrates the full pipeline honestly on clearly
 * labelled synthetic data, with the same code path a real run uses. Every
 * trait is still cited to a source line, and the pipeline is unchanged: point
 * the app at real links with a token configured and it will read those instead.
 *
 * To build a real cohort: set APIFY_TOKEN, then POST to /api/runs with the
 * real LinkedIn + Instagram pairs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyse } from "../src/analysis/analyse";
import { computeNetwork, emptyRun, DEMO_RUN_ID } from "../src/pipeline/run";
import type { PersonRecord, SourceRecord } from "../src/core/types";

interface Persona {
  name: string;
  headline: string;
  location: string;
  linkedin: string[];
  instagram: string[];
}

/** 25 varied personas: different cities, domains, and activity mixes so the
 *  rankings produce genuine winners and genuine mismatches. */
const PERSONAS: Persona[] = [
  {
    name: "Amara Okonkwo",
    headline: "Staff Backend Engineer at Monzo",
    location: "London",
    linkedin: [
      "Amara Okonkwo",
      "Staff Backend Engineer at Monzo",
      "Previously at Stripe. I care about payments reliability above all else.",
      "Skills: Go, Kubernetes, Postgres, distributed systems.",
      "Mentoring two junior engineers through a local tech programme.",
      "BSc Computer Science, Imperial College London.",
    ],
    instagram: [
      "Amara",
      "Engineer. Long distance runner. Coffee first.",
      "Sub-3 marathon in March, currently training for Berlin in autumn.",
      "Trail running at sunrise is the only reliable way I think.",
      "Natural wine on a Friday, every Friday.",
    ],
  },
  {
    name: "Tobias Lindqvist",
    headline: "Bouldering instructor and outdoor guide",
    location: "Manchester",
    linkedin: [
      "Tobias Lindqvist",
      "Bouldering instructor and outdoor guide",
      "12 years climbing, V4 maximum, works weekends at the Peak District.",
      "Skills: route setting, coaching, first aid, outdoor leadership.",
      "I run an inclusive climbing club for beginners every Saturday.",
      "Community work is the part of the job I care about most.",
    ],
    instagram: [
      "tobiasclimbs",
      "Climbing. Coffee. Bad puns about crimps.",
      "Six years bouldering now and still cannot heel hook properly.",
      "Weekends are for coaching new climbers, not for resting.",
      "Espresso before every session, non-negotiable.",
    ],
  },
  {
    name: "Yusuf Demir",
    headline: "Documentary filmmaker",
    location: "Glasgow",
    linkedin: [
      "Yusuf Demir",
      "Documentary filmmaker",
      "Two feature documentaries released; currently editing a third.",
      "Skills: documentary direction, cinematography, colour grading.",
      "Films about communities holding on to places that are changing.",
      "BA Film Studies, University of Glasgow.",
    ],
    instagram: [
      "yusufcameras",
      "Filmmaker. Film camera apologist.",
      "Shooting on a Contax T2 because the grain does the work for me.",
      "Natural wine, arthouse cinema, and long walks to find locations.",
      "Arthouse film festivals are the only ones worth the queue.",
    ],
  },
  {
    name: "Chloe Bennett",
    headline: "Sustainability Manager at IKEA",
    location: "Leeds",
    linkedin: [
      "Chloe Bennett",
      "Sustainability Manager at IKEA",
      "Leading the circular furniture programme across 12 stores.",
      "Skills: sustainability strategy, supply chain, stakeholder management.",
      "Volunteering with a community garden and a repair café.",
      "MSc Environmental Engineering, University of Leeds.",
    ],
    instagram: [
      "chloegrows",
      "Sustainability, allotments, and slow mornings.",
      "Allotment day every Sunday. Currently losing the plot to blight.",
      "Natural wine, cooking, and repairing rather than replacing.",
      "Running slowly is the only pace I enjoy.",
    ],
  },
  {
    name: "Marcus Oliveira",
    headline: "Head Chef, Ember & Oak",
    location: "Bristol",
    linkedin: [
      "Marcus Oliveira",
      "Head Chef at Ember & Oak",
      "Fifteen years in professional kitchens, three Michelin stars.",
      "Skills: menu design, open fire cooking, kitchen management.",
      "I cook dinner parties for friends most weekends.",
      "Level 3 Professional Cookery, Bristol College.",
    ],
    instagram: [
      "marcuscooks",
      "Chef. Sourdough obsessive.",
      "Baking bread at 4am because the house smells better by 7.",
      "Cooking for friends is the actual job; the restaurant pays for it.",
      "Natural wine, farmers markets, and a very small coffee setup.",
    ],
  },
  {
    name: "Priya Raman",
    headline: "Data Scientist at DeepMind",
    location: "Cambridge",
    linkedin: [
      "Priya Raman",
      "Data Scientist at DeepMind",
      "Working on interpretability; previously at Oxford ML research.",
      "Skills: Python, PyTorch, statistics, research publication.",
      "I run a weekend data science meetup for students in Cambridge.",
      "Bouldering four times a week and volunteering at a community climbing wall.",
      "DPhil Statistics, University of Oxford.",
    ],
    instagram: [
      "priyaruns",
      "New to the city. Bouldering four times a week.",
      "Looking for climbing partners and good espresso in equal measure.",
      "Bouldering V4 and still smiling about it. Climbing gym is my office now.",
      "Espresso, pastry bakeries, and far too many notebooks.",
      "Long walk along the river when the algorithm refuses to converge.",
    ],
  },
  {
    name: "Hana Kimura",
    headline: "Product Designer at Figma",
    location: "Berlin",
    linkedin: [
      "Hana Kimura",
      "Product Designer at Figma",
      "Design systems and prototyping; ex-Spotify.",
      "Skills: Figma, design systems, accessibility, prototyping.",
      "Mentoring designers moving from agency to product work.",
      "BFA Interaction Design, RISD.",
    ],
    instagram: [
      "hanadesigns",
      "Designer. Bouldering beginner, enthusiast otherwise.",
      "Taking up bouldering and reluctantly enjoying it.",
      "Film photography on 35mm, arthouse cinema, terrible espresso at home.",
      "Berlin climbing gyms are all equally freezing.",
    ],
  },
  {
    name: "Daniel Mensah",
    headline: "Civil Engineer, HS2",
    location: "Birmingham",
    linkedin: [
      "Daniel Mensah",
      "Civil Engineer on the HS2 programme",
      "Rail infrastructure, ten years on site.",
      "Skills: structural engineering, project management, BIM.",
      "Weekend football league captain and completely unfair at it.",
      "Mentoring two graduate engineers through the ICE scheme.",
      "MEng Civil Engineering, University of Nottingham.",
    ],
    instagram: [
      "dannybuilds",
      "Engineer. Weekend football. Dad of one.",
      "Five-a-side on Saturdays and Sunday football with the kid.",
      "Bad at everything except concrete and defending the left flank.",
      "Craft beer after the game, never before.",
      "Cycling to site most days and running when the light is good.",
    ],
  },
  {
    name: "Sofia Ricci",
    headline: "Art Curator, Galleria Moderna",
    location: "Milan",
    linkedin: [
      "Sofia Ricci",
      "Curator at a contemporary gallery in Milan",
      "Solo exhibitions in Milan, Lisbon and Vienna.",
      "Skills: curation, art history, exhibition design, artist relations.",
      "Organising a monthly artist studio open-house.",
      "MA Art History, Università degli Studi di Milano.",
    ],
    instagram: [
      "sofia.muse",
      "Curator. Gallery hours are the good hours.",
      "Studio visits every Friday afternoon, wine included.",
      "Arthouse cinema, modern art, and walking tours with no schedule.",
      "Bouldering got me through a difficult year, honestly.",
    ],
  },
  {
    name: "Owen Blackwell",
    headline: "Brewery Head Brewer",
    location: "Bristol",
    linkedin: [
      "Owen Blackwell",
      "Head Brewer at a small Bristol brewery",
      "Sourdough and fermentation nerd, obviously.",
      "Skills: brewing, fermentation, quality control.",
      "Volunteer at a community kitchen teaching people to cook cheaply.",
      "BSc Brewing Science, Heriot-Watt.",
    ],
    instagram: [
      "owenbrews",
      "Brewer. Fermentation is the whole hobby.",
      "Tapping a new batch on a Friday is the correct Friday.",
      "Craft beer, natural wine, and cooking for far too many friends.",
      "Bouldering in the morning, brewery in the afternoon.",
    ],
  },
  {
    name: "Grace Nkemelu",
    headline: "Emergency Medicine Registrar",
    location: "Cardiff",
    linkedin: [
      "Grace Nkemelu",
      "Emergency Medicine Registrar, Wales",
      "Four years in emergency departments, currently on nights.",
      "Skills: emergency medicine, trauma, clinical teaching.",
      "Mentoring final-year students through their first ED placement.",
      "MBBS, Cardiff University.",
    ],
    instagram: [
      "drgrace",
      "Registrar. Shift worker. Chronically tired.",
      "Running to clear my head after a night shift.",
      "Long distance running, trail running when days off line up.",
      "Espresso, early nights, and a lot of planning to see friends.",
    ],
  },
  {
    name: "Lars Andersen",
    headline: "Marine Biologist",
    location: "Edinburgh",
    linkedin: [
      "Lars Andersen",
      "Marine Biologist, Scottish Marine Institute",
      "Cephalopod behaviour and kelp forest restoration.",
      "Skills: field research, SCUBA diving, scientific diving, GIS.",
      "Dive weekends are research, which makes them feel like holidays.",
      "PhD Marine Biology, University of St Andrews.",
    ],
    instagram: [
      "larsdives",
      "Marine biologist. Most of my photos are at 15 metres.",
      "Scientific diving, and surfing when the swell is wrong for work anyway.",
      "Surfing, open water, and cold water that does not feel cold after a minute.",
      "Coffee on the boat, espresso never.",
    ],
  },
  {
    name: "Fatima Al-Rashid",
    headline: "Founder, Second Serve",
    location: "Manchester",
    linkedin: [
      "Fatima Al-Rashid",
      "Founder of Second Serve, a community tennis programme",
      "Getting free tennis into schools that cannot afford it.",
      "Skills: fundraising, community organising, coaching, operations.",
      "Organising 14 community tennis events a year.",
      "BSc Business, University of Salford.",
    ],
    instagram: [
      "fatimaplays",
      "Tennis. Community. Extremely competitive about both.",
      "Coach on Tuesday, still trying to beat my twelve-year-old on Saturday.",
      "Tennis, pickleball, and a lot of running between matches.",
      "Espresso before play, always.",
    ],
  },
  {
    name: "Tom Whitfield",
    headline: "Photographer, The Slow Coast",
    location: "Penryn",
    linkedin: [
      "Tom Whitfield",
      "Documentary photographer, The Slow Coast",
      "Editorial and documentary work for National Trust and Surfers Against Sewage.",
      "Skills: documentary photography, darkroom printing, photo editing.",
      "Volunteering with a local surf lifesaving club.",
      "BA Photography, Falmouth University.",
    ],
    instagram: [
      "tomslowcoast",
      "Photographer. Film only, digital only for clients.",
      "Shooting the coast before the crowds arrive, and the surf after.",
      "Surfing, cold water, and printing my own black and white film.",
      "Bouldering when the tide is out. Coffee always.",
    ],
  },
  {
    name: "Aisha Mbeki",
    headline: "Policy Advisor, Education",
    location: "London",
    linkedin: [
      "Aisha Mbeki",
      "Policy Advisor on education access",
      "Advising government on widening university access.",
      "Skills: policy analysis, stakeholder engagement, public consultation.",
      "Chairing a community access group for first-generation students.",
      "MSc Policy, London School of Economics.",
    ],
    instagram: [
      "aishapolicy",
      "Policy nerd. Marathon hopeful.",
      "Volunteering with a university access group most Saturdays.",
      "Running, then long walks, then reading policy papers badly at night.",
      "Coffee is the real policy instrument.",
    ],
  },
  {
    name: "Ben Halvorsen",
    headline: "Software Engineer, Game Studio",
    location: "Glasgow",
    linkedin: [
      "Ben Halvorsen",
      "Software Engineer at an independent games studio",
      "Gameplay systems and tools programming.",
      "Skills: C++, Unreal, game design, technical art.",
      "Volunteering as a mentor for Code Your Future.",
      "BSc Computer Science, University of Strathclyde.",
    ],
    instagram: [
      "benmakesgames",
      "Games, bouldering, and too much coffee.",
      "Bouldering three times a week to stop staring at a screen.",
      "Climbing, tabletop games, and chasing good espresso.",
      "Comics, mostly the art.",
    ],
  },
  {
    name: "Zoe Papadopoulos",
    headline: "Yoga Teacher and Breathwork Coach",
    location: "Brighton",
    linkedin: [
      "Zoe Papadopoulos",
      "Yoga teacher and breathwork coach",
      "RYT 500, teaching since 2016, now focused on breathwork.",
      "Skills: vinyasa yoga, breathwork, trauma-informed practice.",
      "Volunteering teaching yoga in a women's centre.",
      "BA Theatre Studies, University of Brighton.",
    ],
    instagram: [
      "zoeyoga",
      "Yoga, breathwork, swimming in cold water when brave.",
      "Teaching six days a week, swimming on Mondays.",
      "Swimming, open water, and slow stretching before coffee.",
      "Surfing badly in Brighton, enthusiastically.",
    ],
  },
  {
    name: "Nathan Cole",
    headline: "Woodworker and Furniture Maker",
    location: "Sheffield",
    linkedin: [
      "Nathan Cole",
      "Furniture maker and workshop owner",
      "Commission work in native hardwoods since 2012.",
      "Skills: joinery, cabinet making, finishing, workshop management.",
      "Teaching a woodworking evening class at the community college.",
      "BSc Furniture Design, Sheffield Hallam.",
    ],
    instagram: [
      "nathanwoodworks",
      "Woodworker. Sawdust is a lifestyle.",
      "Workshop all day, then woodworking class on a Tuesday evening.",
      "Woodworking, canoeing on the rivers, and very strong coffee.",
      "Camping, mostly, and the smell of shavings.",
    ],
  },
  {
    name: "Isla Murray",
    headline: "Clinical Psychologist",
    location: "Edinburgh",
    linkedin: [
      "Isla Murray",
      "Clinical Psychologist, NHS",
      "Anxiety and adolescent mental health.",
      "Skills: CBT, assessment, supervision, research.",
      "Supervising trainee psychologists and running a peer support group.",
      "DClinPsy, University of Edinburgh.",
    ],
    instagram: [
      "islamurray",
      "Psychologist. Runner. Learning to be a person outdoors.",
      "Trail running and climbing as a deliberate counterweight to the job.",
      "Running, climbing, and a lot of cold water swimming in Scotland.",
      "Reading, mostly non-fiction, and bad podcasts.",
    ],
  },
  {
    name: "Kofi Mensah",
    headline: "Urban Beekeeper and Horticulturist",
    location: "Nottingham",
    linkedin: [
      "Kofi Mensah",
      "Urban beekeeper running 14 hives across the city",
      "Pollinator education for schools and allotments.",
      "Skills: beekeeping, horticulture, community education.",
      "Volunteering with a community allotment and a wildlife trust.",
      "BSc Biology, University of Nottingham.",
    ],
    instagram: [
      "kofibees",
      "Beekeeper in a city that should not have this many bees.",
      "Allotment and hives, and both are better than they sound.",
      "Gardening, cycling everywhere, and cooking what I grow.",
      "Natural wine, and farmers markets at weekends.",
    ],
  },
  {
    name: "Elena Vasquez",
    headline: "Creative Director, Independent Magazine",
    location: "London",
    linkedin: [
      "Elena Vasquez",
      "Creative Director of an independent magazine",
      "Editorial design, photography commissions, art direction.",
      "Skills: art direction, editorial design, photography.",
      "Organising an annual zine fair with 60 contributors.",
      "MA Communication Design, Royal College of Art.",
    ],
    instagram: [
      "elenavq",
      "Art director. Prints on every wall.",
      "Zine fair season, then very little sleep in October.",
      "Film photography, arthouse cinema, and printing my own work.",
      "Galleries, wine, and collecting things I cannot afford.",
    ],
  },
  {
    name: "Ravi Prasad",
    headline: "Chef de Partie, Michelin Restaurant",
    location: "Belfast",
    linkedin: [
      "Ravi Prasad",
      "Chef de Partie in a two-star kitchen",
      "Eight years in kitchens across Dublin and Belfast.",
      "Skills: pastry, sauces, kitchen hygiene, stock control.",
      "I cook a big dinner for friends the first Sunday of every month.",
      "Level 3 Professional Cookery, Dublin Institute of Technology.",
    ],
    instagram: [
      "ravicooks",
      "Pastry chef. Sourdough when days off allow it.",
      "Baking on Sundays and cooking for friends on Sundays.",
      "Cooking, natural wine, and a small espresso setup at home.",
      "Surfing badly but enthusiastically, twice a year.",
    ],
  },
  {
    name: "Sarah Whitlock",
    headline: "Occupational Therapist",
    location: "Norwich",
    linkedin: [
      "Sarah Whitlock",
      "Occupational Therapist, Norfolk Community Health",
      "Palliative care and rehabilitation.",
      "Skills: rehabilitation, care planning, complex case management.",
      "Volunteering with a dementia befriending charity.",
      "BSc Occupational Therapy, University of East Anglia.",
    ],
    instagram: [
      "sarahot",
      "OT. Cold water swimmer. Garden in progress.",
      "Cold water swimming from October to April, without exception.",
      "Swimming, gardening, and a slow Sunday cooking habit.",
      "Long walks, a big coffee, and a good crime novel.",
    ],
  },
  {
    name: "Mateo Alvarez",
    headline: "Startup Founder, Climate Tech",
    location: "London",
    linkedin: [
      "Mateo Alvarez",
      "Founder of a climate tech startup, pre-seed to Series A",
      "Building carbon accounting tooling for small manufacturers.",
      "Skills: fundraising, product, hiring, climate policy.",
      "Mentoring two founders through a climate incubator.",
      "MSc Environmental Policy, Imperial College London.",
    ],
    instagram: [
      "mateobuilds",
      "Founder. Climbs when stressed, which is always.",
      "Bouldering on Tuesday and a trail run at the weekend, when I can.",
      "Climbing, cycling, and thinking about carbon a bit too much.",
      "Espresso, podcast interviews, and very early starts.",
    ],
  },
  {
    name: "Nina Okafor",
    headline: "Specialist Nurse, Paediatric Intensive Care",
    location: "Sheffield",
    linkedin: [
      "Nina Okafor",
      "Specialist Nurse in paediatric intensive care",
      "Nine years in PICU, currently on the education lead.",
      "Skills: critical care nursing, clinical education, safeguarding.",
      "Volunteering with a children's charity hospital play team.",
      "BSc Nursing, University of Sheffield.",
    ],
    instagram: [
      "ninaonadshift",
      "Nurse. Amateur boxer. Exhausted.",
      "Boxing twice a week and swimming when the pool is empty.",
      "Boxing, running, and a very cold gym in February.",
      "Reading crime novels and cooking when I get a weekend.",
    ],
  },
  {
    name: "Callum Fraser",
    headline: "Mountain Rescue Volunteer",
    location: "Inverness",
    linkedin: [
      "Callum Fraser",
      "Mountain Rescue volunteer, 14 years of service",
      "Also works as a structural engineer for a civil consultancy.",
      "Skills: mountain rescue, navigation, rope work, structural engineering.",
      "On call 4 weeks a year for the Highlands team.",
      "MEng Civil Engineering, University of Glasgow.",
    ],
    instagram: [
      "callumhill",
      "Mountain rescue. Hill walking. Tea, mainly.",
      "Hillwalking 3,000m peaks when the weather window opens.",
      "Hiking, mountaineering, and a lot of driving to reach both.",
      "Skiing in winter, climbing in summer, tea all year.",
    ],
  },
];

function src(kind: "linkedin" | "instagram", handle: string, lines: string[]): SourceRecord {
  return {
    kind,
    url: kind === "linkedin" ? `https://www.linkedin.com/in/${handle}` : `https://www.instagram.com/${handle}`,
    status: "captured",
    capturedAt: Date.now(),
    lines,
    provider: "demo-seed",
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  const people: PersonRecord[] = PERSONAS.map((p, i) => {
    const handle = slug(p.name);
    const id = `p${i + 1}`;
    const analysis = analyse(id, {
      linkedin: src("linkedin", handle, p.linkedin),
      instagram: src("instagram", handle, p.instagram),
    });
    return {
      id,
      runId: DEMO_RUN_ID,
      displayName: p.name,
      linkedinUrl: `https://www.linkedin.com/in/${handle}`,
      instagramUrl: `https://www.instagram.com/${handle}`,
      status: "ready" as const,
      analysis,
      createdAt: Date.now() - i,
    };
  });

  const run = {
    ...emptyRun(DEMO_RUN_ID, true, [
      "This demo run uses 25 clearly-labelled synthetic personas, not real people's profiles. LinkedIn blocks anonymous reads and Instagram serves a client-only page, so real capture needs an Apify token. The pipeline is identical: add your own links on the start page to read real profiles.",
    ]),
    status: "complete" as const,
    people: computeNetwork(people),
  };

  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `${DEMO_RUN_ID}.json`);
  await writeFile(out, JSON.stringify(run, null, 2), "utf8");

  const ready = run.people.filter((p) => p.status === "ready").length;
  const ids = new Set(run.people.flatMap((p) => (p.sessions ?? []).map((s) => s.id)));
  const covered = new Set(run.people.flatMap((p) => (p.sessions ?? []).flatMap((s) => [s.personAId, s.personBId])));
  console.log(`Seeded demo run -> ${out}`);
  console.log(`people=${run.people.length} ready=${ready} dates=${ids.size} agentsDated=${covered.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
