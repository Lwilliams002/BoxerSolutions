import { ImageSourcePropType } from 'react-native';

// Maps agreement pest names to their images in mobile/pests/.
// Unknown pests fall back to the general icon.
const GENERAL: ImageSourcePropType = require('../../pests/general.png');
const ANT: ImageSourcePropType = require('../../pests/ant.png');
const BEETLE: ImageSourcePropType = GENERAL;
const CENTIPEDE: ImageSourcePropType = require('../../pests/centipede.png');
const CRICKET: ImageSourcePropType = require('../../pests/cricket.png');
const COCKROACH: ImageSourcePropType = require('../../pests/cockroach.png');
const EARWIG: ImageSourcePropType = require('../../pests/earwig.png');
const BEE: ImageSourcePropType = require('../../pests/bee.png');
const FLEA: ImageSourcePropType = require('../../pests/flea.png');
const HORNET: ImageSourcePropType = require('../../pests/hornet.png');
const MITE: ImageSourcePropType = GENERAL;
const MILLIPEDE: ImageSourcePropType = require('../../pests/millepede.png');
const NOSEEUM: ImageSourcePropType = require('../../pests/noseeum.png');
const MOSQUITO: ImageSourcePropType = require('../../pests/mosquito.png');
const PACKRAT: ImageSourcePropType = require('../../pests/packrat.png');
const PIGEON: ImageSourcePropType = require('../../pests/pigeon.png');
const COMMERCIAL: ImageSourcePropType = require('../../pests/commercial.png');
const KISSINGBUG: ImageSourcePropType = require('../../pests/kissingbug.png');
const IGUANA: ImageSourcePropType = require('../../pests/iguana.png');
const RODENT: ImageSourcePropType = require('../../pests/rodent.png');
const SCORPION: ImageSourcePropType = require('../../pests/scorpion.png');
const SPIDER: ImageSourcePropType = require('../../pests/spider.png');
const SILVERFISH: ImageSourcePropType = require('../../pests/sliverfish.png');
const WASP: ImageSourcePropType = require('../../pests/wasp.png');
const TERMITE: ImageSourcePropType = require('../../pests/termite.png');
const WILDLIFE: ImageSourcePropType = require('../../pests/wildlife.png');

const PEST_IMAGES: Record<string, ImageSourcePropType> = {
  'box elder bugs': BEETLE,
  'asian beetles': BEETLE,
  centipedes: CENTIPEDE,
  clovermites: MITE,
  crickets: CRICKET,
  'sow / pill bug': GENERAL,
  spiders: SPIDER,
  'household ants': ANT,
  'palmetto bugs': COCKROACH,
  'yard ants': ANT,
  'fire ants': ANT,
  'carpenter ants': ANT,
  fleas: FLEA,
  ticks: FLEA,
  'black widow': SPIDER,
  'brown recluse': SPIDER,
  'spider web removal': SPIDER,
  'wasps / hornets': HORNET,
  millipedes: MILLIPEDE,
  silverfish: SILVERFISH,
  earwigs: EARWIG,
  mosquitoes: MOSQUITO,
  mosquito: MOSQUITO,
  termites: TERMITE,
  termite: TERMITE,
  rodents: RODENT,
  rodent: RODENT,
  scorpions: SCORPION,
  scorpion: SCORPION,
  wasps: WASP,
  hornets: HORNET,
  bees: BEE,
  bee: BEE,
  wildlife: WILDLIFE,
  'pack rats': PACKRAT,
  packrat: PACKRAT,
  pigeons: PIGEON,
  pigeon: PIGEON,
  'noseeums': NOSEEUM,
  'noseeum': NOSEEUM,
  'kissing bugs': KISSINGBUG,
  'kissing bug': KISSINGBUG,
  iguanas: IGUANA,
  iguana: IGUANA,
  commercial: COMMERCIAL,
};

export function pestImage(name: string): ImageSourcePropType {
  return PEST_IMAGES[name.trim().toLowerCase()] ?? GENERAL;
}
