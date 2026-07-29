const FACTIONS = {
  cizalla: { label: 'Cizalla', color: '#e74c3c' },
  sup: { label: 'S.U.P', color: '#3498db' },
  urbino: { label: 'Urbino', color: '#f1c40f' },
};

const CHARACTERS = {
  cizalla: [
    { name: 'Eika', file: 'Eika.png' },
    { name: 'Fragrans', file: 'Fragrans.png' },
    { name: 'Kanami', file: 'Kanami.png' },
    { name: 'Lawine', file: 'Lawine.png' },
    { name: 'Mara', file: 'Mara.png' },
    { name: 'Meredith', file: 'Meredith.png' },
    { name: 'Ming', file: 'Ming.png' },
    { name: 'Nora', file: 'Nora.png' },
    { name: 'Reiichi', file: 'Reiichi.png' },
  ],
  sup: [
    { name: 'Chiyo', file: 'Chiyo.png' },
    { name: 'Flavia', file: 'Flavia.png' },
    { name: 'Kokona', file: 'Kokona.png' },
    { name: 'Leona', file: 'Leona.png' },
    { name: 'Michele', file: 'Michele.png' },
    { name: 'Nobunaga', file: 'Nobunaga.png' },
    { name: 'Yugiri', file: 'Yugiri.png' },
    { name: 'Yvette', file: 'Yvette.png' },
  ],
  urbino: [
    { name: 'Audrey', file: 'Audrey.png' },
    { name: 'Bai Mo', file: 'BaiMo.png' },
    { name: 'Celestia', file: 'Celestia.png' },
    { name: 'Cielle', file: 'Cielle.png' },
    { name: 'Fuchsia', file: 'Fuchsia.png' },
    { name: 'Galatea', file: 'Galatea.png' },
    { name: 'Maddelena', file: 'Maddelena.png' },
  ],
};

const ALL_CHARS = Object.entries(CHARACTERS).flatMap(([faction, chars]) =>
  chars.map(c => ({ ...c, faction }))
);

function getRandomChar(faction) {
  const pool = CHARACTERS[faction];
  return { ...pool[Math.floor(Math.random() * pool.length)], faction };
}

function spinRoulette() {
  const winner = ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)];
  let left, right;
  if (winner.faction === 'urbino') {
    left = right = winner;
  } else if (winner.faction === 'cizalla') {
    left = winner;
    right = getRandomChar('sup');
  } else {
    left = getRandomChar('cizalla');
    right = winner;
  }
  return { left, right };
}

const RANKS = [
  { name: 'Substance',  id: 'substance',  tiers: ['III','II','I'],          image: 'Substance III-I.png' },
  { name: 'Molecule',   id: 'molecule',   tiers: ['III','II','I'],          image: 'Molecule III-I.png' },
  { name: 'Atom',       id: 'atom',       tiers: ['IV','III','II','I'],     image: 'Atom IV-I.png' },
  { name: 'Proton',     id: 'proton',     tiers: ['IV','III','II','I'],     image: 'Proton IV-I.png' },
  { name: 'Neutron',    id: 'neutron',    tiers: ['IV','III','II','I'],     image: 'Neutron IV-I.png' },
  { name: 'Electron',   id: 'electron',   tiers: ['V','IV','III','II','I'], image: 'Electron IV-I.png' },
  { name: 'Quark',      id: 'quark',      tiers: ['V','IV','III','II','I'], image: 'Quark V-I.png' },
  { name: 'Superstring',id: 'superstring', tiers: [''],                     image: 'Superstring.png' },
  { name: 'Singularity',id: 'singularity', tiers: [''],                     image: 'Singularity.png' },
];
