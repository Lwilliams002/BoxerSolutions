/** South Florida pest programs, ported from the previous company site. */
export interface PestProgram {
  slug: string;
  name: string;
  short: string;
  img: string;
  about: string;
  signs: string[];
  risk: string;
  approach: string;
  seasonal?: string;
  southFloridaOnly?: boolean;
}

export const PEST_PROGRAMS: PestProgram[] = [
  { slug: 'general', name: 'General Pest Control', short: 'General', img: 'general.png', about: 'An all-in-one perimeter program for the everyday pests — ants, spiders, crickets, silverfish, earwigs and occasional invaders — with family- and pet-conscious products.', signs: ['Spotting bugs more than once a month', 'Webs around eaves and corners', 'Activity along baseboards'], risk: 'Small problems compound fast in our climate without ongoing protection.', approach: 'Regular home defense covering the most common indoor and outdoor pests.' },
  { slug: 'centipede', name: 'Centipede Control', short: 'Centipedes', img: 'centipede.png', about: 'Centipedes move fast through damp mulch, bathrooms, garages and block-wall gaps while hunting other insects. South Florida moisture keeps them active year-round.', signs: ['Long, fast-moving insects in bathrooms or garages', 'Activity after heavy rain or irrigation', 'Sightings around mulch, drains and slab cracks'], risk: 'Bites can be painful, and frequent sightings usually point to moisture or other pest activity.', approach: 'Moisture reduction and perimeter treatments.', southFloridaOnly: true },
  { slug: 'millipede', name: 'Millipede Control', short: 'Millipedes', img: 'millepede.png', about: 'Millipedes feed on damp organic material and pile up along sliders, patios, garages and baseboards after rain. They do not bite, but they invade in large numbers.', signs: ['Curled-up millipedes near doors and sliders', 'Large numbers after storms', 'Activity around mulch beds, planters and wet leaf litter'], risk: 'Repeated invasions mean moisture and decaying organic matter are supporting pest pressure.', approach: 'Exterior moisture and harborage treatment for seasonal invasions.', southFloridaOnly: true },
  { slug: 'earwig', name: 'Earwig Control', short: 'Earwigs', img: 'earwig.png', about: 'Dark, pincer-tailed insects that hide in damp mulch, leaf litter and under pots. They wander indoors after heavy rain or irrigation.', signs: ['Pincer bugs in bathtubs and sinks', 'Notched leaves on plants', 'Activity under flowerpots and stones'], risk: 'Mostly a nuisance, but populations explode fast in irrigated landscaping.', approach: 'Perimeter dust and granular treatments around foundations and mulch.' },
  { slug: 'flea', name: 'Flea & Tick Treatment', short: 'Fleas & Ticks', img: 'flea.png', about: 'Tiny jumping parasites that ride in on pets and wildlife. Eggs and larvae live in carpet, bedding and shaded yard areas — adults are only 5% of the population.', signs: ['Itchy red bites around ankles', 'Pets scratching constantly', "Black 'pepper' specks in pet bedding"], risk: 'Transmit tapeworms and other diseases to pets and people.', approach: 'Indoor and yard knockdown with growth regulators that break the cycle.' },
  { slug: 'hornet', name: 'Hornet Control', short: 'Hornets', img: 'hornet.png', about: 'Large, aggressive social wasps that build paper nests in trees, sheds and attics. They defend the nest with repeated stings.', signs: ['Football-shaped paper nests', 'Hornets patrolling a single area', 'Buzzing inside walls or attics'], risk: 'Multiple stings can be life-threatening — never DIY a mature nest.', approach: 'Safe nest removal and residual treatment around eaves and trees.' },
  { slug: 'wasp', name: 'Wasp Control', short: 'Wasps', img: 'wasp.png', about: 'Paper wasps and yellowjackets build umbrella-shaped nests under overhangs. Aggressive when disturbed — yellowjackets can sting repeatedly.', signs: ['Wasps entering a small hole in siding', 'Open-comb nests under eaves', 'Increased activity around trash cans'], risk: 'Painful, sometimes anaphylactic stings; nests grow rapidly in summer.', approach: 'Nest knockdown and residual treatment under eaves, in grills and sheds.' },
  { slug: 'rodent', name: 'Rodent Control', short: 'Rodents', img: 'rodent.png', about: 'Roof rats, Norway rats and house mice chew through wire, insulation and food packaging — and reproduce shockingly fast.', signs: ['Scratching in walls or ceilings at night', 'Dark, rice-shaped droppings', 'Gnaw marks on wood or wiring'], risk: 'Carry hantavirus and leptospirosis; chewed wiring is a top fire cause.', approach: 'Inspection, exclusion, trapping and clean-up of affected areas.' },
  { slug: 'silverfish', name: 'Silverfish Control', short: 'Silverfish', img: 'sliverfish.png', about: 'Teardrop-shaped, silvery, fast-moving insects that thrive in humid, dark spaces. They feed on paper, glue, starches and fabric.', signs: ['Yellow stains on paper or books', 'Tiny holes in stored clothing', 'Pepper-like droppings in cabinets'], risk: 'Damage books, photos, wallpaper and stored linens over time.', approach: 'Crack-and-crevice treatment in attics, bathrooms and storage areas.' },
  { slug: 'spider', name: 'Spider Control', short: 'Spiders', img: 'spider.png', about: 'Black widows and brown spiders hide in block walls, garages and patio furniture. Most other spiders are harmless — but webs and egg sacs multiply fast.', signs: ['Tangled webs under patio furniture', 'Egg sacs in garage corners', 'Spiders in shoes or stored boxes'], risk: 'Widow bites are medically significant; brown recluse bites can scar.', approach: 'Web removal, dusting and prevention around eaves, garages and yards.' },
  { slug: 'termite', name: 'Termite Control', short: 'Termites', img: 'termite.png', about: 'Subterranean termites (including invasive Formosan) tunnel up from soil; drywood termites live entirely inside wood. Damage is rarely covered by insurance.', signs: ['Mud tubes on foundation walls', 'Discarded wings near windowsills', 'Hollow-sounding or blistered wood'], risk: 'Cause billions in structural damage every year across the U.S.', approach: 'Subterranean and drywood programs tuned to local construction.' },
  { slug: 'commercial', name: 'Commercial Pest Control', short: 'Commercial', img: 'commercial.png', about: 'Custom programs for businesses with health-code obligations. Discreet uniforms, after-hours service and full digital documentation for inspectors.', signs: ['Failed health inspection prep', 'Guest or tenant complaints', 'Recurring issues across units'], risk: 'One sighting can cost a review, a license or a lease.', approach: 'Hotels, restaurants, marinas and multifamily — discreet schedules.' },
];

export interface FeaturedProgram {
  slug: string;
  img: string;
  kicker: string;
  headline: string;
  body: string;
  steps: { label: string; body: string }[];
  badges: string[];
}

export const FEATURED_PROGRAMS: FeaturedProgram[] = [
  {
    slug: 'mosquito', img: 'mosquito.png', kicker: 'Summer hotspot · South Florida', headline: 'Mosquito season is here.',
    body: 'Afternoon storms, irrigated lawns and bromeliads turn South Florida yards into a 24-hour mosquito nursery. Aedes mosquitoes only need a bottle cap of standing water to breed — and they are the ones spreading Zika, dengue and West Nile across the coast every summer.',
    steps: [
      { label: 'Inspect', body: 'We walk the whole yard — gutters, bromeliads, AC pans, plant saucers, bird baths — and map every breeding site before we treat anything.' },
      { label: 'Knock down', body: 'Targeted fogging of foliage, hedges and shaded harborage drops the adult population fast — usually noticeable by the next evening.' },
      { label: 'Break the cycle', body: 'Larvicide in standing water plus monthly re-treats during the wet season stop the next generation before it hatches.' },
    ],
    badges: ['Pet & kid conscious', 'Event prep (24–48 hr)', 'Monthly wet-season plans'],
  },
  {
    slug: 'roach', img: 'cockroach.png', kicker: 'Year-round threat · South Florida', headline: 'German roaches spread fast.',
    body: 'Small, tan and impossibly prolific — German roaches hide in warm, humid voids around dishwashers, fridges and cabinet hinges. One missed egg case becomes hundreds of roaches in weeks, which is why over-the-counter sprays only scatter the problem.',
    steps: [
      { label: 'Inspect', body: 'Flashlight inspection of every hinge, motor void and appliance kick-plate to map the harborage before treatment.' },
      { label: 'Gel & dust', body: 'Precision gel baiting plus crack-and-crevice dust hits the colony where they hide — no kitchen-wide spray needed.' },
      { label: 'Follow-up', body: 'Scheduled re-treats break the next hatch cycles so a single egg case cannot restart the infestation.' },
    ],
    badges: ['Discreet for kitchens', 'Restaurant-ready protocols', 'Multifamily programs'],
  },
  {
    slug: 'ants', img: 'ant.png', kicker: 'Coastal favorite · South Florida', headline: 'Ants find every crack.',
    body: 'Ghost ants, white-footed ants and big-headed ants trail through stucco cracks, soffits and irrigation lines into kitchens and bathrooms. Spraying the trail just splits the colony — proper baiting wipes the whole nest out.',
    steps: [
      { label: 'Identify', body: 'We identify the species first — ghost, white-footed or big-headed — because each one needs a different bait to actually work.' },
      { label: 'Bait the colony', body: 'Slow-acting baits ride back to the queens and satellite nests so the whole colony collapses, not just the workers you see.' },
      { label: 'Seal the trail', body: 'Perimeter treatment plus targeted exclusion around plumbing and electrical penetrations keeps new colonies from moving in.' },
    ],
    badges: ['Pet & kid conscious', 'Kitchen-safe baits', 'Ghost & white-footed specialists'],
  },
];

export const SERVICE_CITIES = [
  'Miami', 'Hialeah', 'Miami Beach', 'Miami Gardens', 'Miami Lakes', 'Brickell', 'Coral Gables', 'Coconut Grove', 'Fontainebleau', 'Tamiami',
  'West End', 'Wynwood', 'Aventura', 'Doral', 'Fort Lauderdale', 'Hollywood', 'Miramar', 'Pembroke Pines', 'Davie', 'Southwest Ranches',
  'Boca Raton', 'Delray Beach', 'West Palm Beach', 'Jupiter', 'Key Biscayne', 'Pinecrest', 'Homestead', 'Kendall',
];
