#!/usr/bin/env node
/* ============================================================================
   📡 fetch-biens.js
   Récupère les annonces depuis l'API 3G IMMO (admin.3gimmobilier.fr)
   et les transforme au format attendu par le site.
   Génère : data/biens.json
   ============================================================================ */

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.API_TOKEN;
if (!TOKEN) {
  console.error('❌ API_TOKEN env var missing — configurez le GitHub Secret API_TOKEN_3GIMMO');
  process.exit(1);
}

const API_URL = `https://admin.3gimmobilier.fr/api/v1/site-perso/annonces?token=${TOKEN}`;

/* ─────────── Mappings 3G IMMO → site ─────────── */

const TYPE_MAP = {
  '1': 'maison',
  '2': 'appartement',
  '3': 'immeuble',
  '4': 'local',
  '5': 'terrain',
  '6': 'maison',
};

/* Helper : construit une regex case-insensitive avec bornes de mots
   compatibles avec les caractères accentués (le \b natif JS ne fonctionne pas
   avec les caractères non-ASCII). */
const LETTER = "[a-zA-ZéèêëàâäôöûüîïçÉÈÊËÀÂÄÔÖÛÜÎÏÇ]";
function rx(pattern) {
  return new RegExp(`(?<!${LETTER})(?:${pattern})(?!${LETTER})`, 'i');
}

// Communes connues (Sarthe + Mayenne + Maine-et-Loire)
const COMMUNES = [
  // Sarthe (72)
  { name: 'Sablé-sur-Sarthe', cp: '72300', re: rx('sabl[ée][\\s-]+sur[\\s-]+sarthe|sabl[ée]') },
  { name: 'Solesmes', cp: '72300', re: rx('solesmes') },
  { name: 'Précigné', cp: '72300', re: rx('pr[ée]cign[ée]') },
  { name: 'Juigné-sur-Sarthe', cp: '72300', re: rx('juign[ée][\\s-]+sur[\\s-]+sarthe') },
  { name: 'Auvers-le-Hamon', cp: '72300', re: rx('auvers[\\s-]+le[\\s-]+hamon') },
  { name: 'Notre-Dame-du-Pé', cp: '72300', re: rx('notre[\\s-]+dame[\\s-]+du[\\s-]+p[ée]') },
  { name: 'Pincé', cp: '72300', re: rx('pinc[ée]') },
  { name: 'Vion', cp: '72300', re: rx('vion') },
  { name: 'Souvigné-sur-Sarthe', cp: '72300', re: rx('souvign[ée][\\s-]+sur[\\s-]+sarthe') },
  { name: 'Le Bailleul', cp: '72200', re: rx('le[\\s-]+bailleul') },
  { name: 'Parcé-sur-Sarthe', cp: '72300', re: rx('parc[ée][\\s-]+sur[\\s-]+sarthe') },
  { name: 'Asnières-sur-Vègre', cp: '72430', re: rx('asni[èe]res[\\s-]+sur[\\s-]+v[èe]gre') },
  { name: 'Avoise', cp: '72430', re: rx('avoise') },
  { name: 'Courcelles-la-Forêt', cp: '72270', re: rx('courcelles[\\s-]+la[\\s-]+for[ée]t') },
  { name: 'Poillé-sur-Vègre', cp: '72350', re: rx('poill[ée][\\s-]+sur[\\s-]+v[èe]gre') },
  { name: 'Chevillé', cp: '72350', re: rx('chevill[ée]') },
  { name: 'Brûlon', cp: '72350', re: rx('br[ûu]lon') },
  { name: 'Dureil', cp: '72270', re: rx('dureil') },
  { name: 'La Flèche', cp: '72200', re: rx('la[\\s-]+fl[èe]che') },
  { name: 'Le Mans', cp: '72000', re: rx('le[\\s-]+mans') },
  { name: "Saint-Denis-d'Orques", cp: '72350', re: rx("saint[\\s-]+denis[\\s'-]+d[\\s'-]+orques") },
  { name: 'Avessé', cp: '72350', re: rx('aves[s]?[ée]') },
  { name: 'Noyen-sur-Sarthe', cp: '72430', re: rx('noyen[\\s-]+sur[\\s-]+sarthe') },
  { name: 'Malicorne-sur-Sarthe', cp: '72270', re: rx('malicorne[\\s-]+sur[\\s-]+sarthe') },
  { name: 'Mont-Saint-Jean', cp: '72650', re: rx('mont[\\s-]+saint[\\s-]+jean') },
  // Mayenne (53)
  { name: 'Bouessay', cp: '53290', re: rx('bouessay') },
  { name: 'Bouère', cp: '53290', re: rx('bou[èe]re') },
  { name: 'Bierné-les-Villages', cp: '53290', re: rx('biern[ée]') },
  { name: 'Saint-Brice', cp: '53290', re: rx('saint[\\s-]+brice') },
  { name: 'Préaux', cp: '53290', re: rx('pr[ée]aux') },
  { name: 'Saint-Loup-du-Dorat', cp: '53290', re: rx('saint[\\s-]+loup[\\s-]+du[\\s-]+dorat') },
  { name: "Saint-Denis-d'Anjou", cp: '53290', re: rx("saint[\\s-]+denis[\\s'-]+d[\\s'-]+anjou") },
  { name: 'Ballée', cp: '53340', re: rx('ball[ée]e') },
  { name: 'Val-du-Maine', cp: '53340', re: rx('val[\\s-]+du[\\s-]+maine') },
  { name: 'Château-Gontier-sur-Mayenne', cp: '53200', re: rx('ch[âa]teau[\\s-]+gontier') },
  { name: 'Mayenne', cp: '53100', re: rx('mayenne') },
  // Maine-et-Loire (49)
  { name: 'Morannes-sur-Sarthe-Daumeray', cp: '49640', re: rx('morannes') },
  { name: 'Daumeray', cp: '49640', re: rx('daumeray') },
  { name: 'Miré', cp: '49330', re: rx('mir[ée]') },
];

/* ─────────── Helpers ─────────── */

function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(String(v).replace(/[^\d.-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function gallery(annonce) {
  const photos = [];
  for (let i = 1; i <= 20; i++) {
    const url = annonce[`photo${i}`];
    if (url && typeof url === 'string' && url.trim()) {
      photos.push(url.trim());
    }
  }
  return photos;
}

// Extrait ville + code postal depuis la description
// Stratégie : trouver TOUS les matches puis garder celui qui apparaît en premier
// dans le texte, en excluant les mentions "à X minutes de", "proche de", etc.
function extractCity(desc) {
  if (!desc) return '';

  // Patterns qui indiquent un POI (proximité), pas la localisation du bien
  const PROXIMITY_PATTERNS = [
    /\b(?:à|a)\s+\d+\s*(?:min|minutes?|km|kilom[èe]tres?)\s+(?:de|du)\s+(?:la\s+(?:gare|ville|sortie|commune))?\s*$/i,
    /\b(?:proche|près|pr[èe]s)\s+(?:de|du|des)\s*$/i,
    /\b(?:gare|gare\s+tgv)\s+(?:de\s+)?$/i,
    /\bautoroute\s+[^\s]*\s*$/i,
    /\bsortie\s+(?:de\s+)?$/i,
  ];

  // Trouver toutes les occurrences avec leur position
  const matches = [];
  for (const c of COMMUNES) {
    let m;
    // Convertir la regex en globale pour trouver toutes les occurrences
    const globalRe = new RegExp(c.re.source, 'gi');
    while ((m = globalRe.exec(desc)) !== null) {
      // Vérifier le contexte avant le match (50 caractères)
      const before = desc.slice(Math.max(0, m.index - 50), m.index);
      const isProximity = PROXIMITY_PATTERNS.some(p => p.test(before));
      matches.push({ commune: c, pos: m.index, isProximity });
    }
  }

  if (matches.length === 0) return '';

  // Priorité 1 : non-proximité, position la plus tôt
  const nonProximity = matches.filter(m => !m.isProximity).sort((a, b) => a.pos - b.pos);
  if (nonProximity.length > 0) {
    return `${nonProximity[0].commune.name} (${nonProximity[0].commune.cp})`;
  }
  // Fallback : première occurrence quel que soit le contexte
  matches.sort((a, b) => a.pos - b.pos);
  return `${matches[0].commune.name} (${matches[0].commune.cp})`;
}

// Détecte un badge depuis la description
function detectBadge(desc, etat_pre_archivage) {
  if (!desc) desc = '';
  const lower = desc.toLowerCase();
  if (Number(etat_pre_archivage) === 2 || /sous\s+compromis/.test(lower)) return 'Sous compromis';
  if (Number(etat_pre_archivage) === 3 || /offre\s+en\s+cours/.test(lower)) return 'Offre en cours';
  if (/baisse\s+de\s+prix/.test(lower)) return 'Baisse de prix';
  if (/(en\s+)?exclusivit[ée]/.test(lower)) return 'Exclusivité';
  return null;
}

// Libellé éditorial par sous_type (3G IMMO)
const SOUS_TYPE_LABEL = {
  '5': 'Maison ancienne',
  '18': 'Maison de ville',
  '25': 'Maison de bourg',
  '47': 'Terrain',
  '61': 'Maison de plain-pied',
  '64': 'Maison familiale',
  '71': 'Longère',
};

// Extrait un titre court à partir de la description.
function extractTitle(desc, type, sous_type) {
  const fromSousType = SOUS_TYPE_LABEL[String(sous_type)];
  const fallback = type === 'terrain' ? 'Terrain'
                 : fromSousType || 'Maison';

  if (!desc) return fallback;

  const lines = desc.split('\n').map(s => s.trim()).filter(Boolean);

  // Lignes à ignorer (boilerplate, section, bullets, propriétés isolées)
  const SKIP = /^(charles\s+morel|📞|📧|☎|✉|coup\s+de\s+c[œo]ur|caract[ée]ristiques|informations\s+compl|au\s+(?:rez|premier|deuxi|sous-sol|étage)|à\s+l['']int[ée]rieur|à\s+l['']ext[ée]rieur|confort\s*:|extérieur|intérieur|prix\s*:|dpe\s|honoraires|les?\s+plus|atouts|[-*•·]\s|une\s+entr[ée]e|surface\s+habitable|nombre\s+de\s+pi[èe]ces|chauffage\s*:|nombre\s+de\s+chambres|menuiseries\s*:|ventilation\s*:|ballon\s+d|cuisine\s+|s[ée]jour|salon|toiture\s*:|fa[çc]ade\s*:|isolation\s*:|au\s+sol|ann[ée]e\s+de|huisseries\s*:|assainissement\s*:|exposition\s*:|orientation\s*:|terrain\s*:|jardin\s*:|.*\s*:\s*$)/i;

  // Trouver la première ligne avec un titre potentiel
  let chosen = '';
  for (const l of lines) {
    if (SKIP.test(l)) continue;
    if (l.length < 4) continue;
    chosen = l;
    break;
  }
  if (!chosen) return fallback;

  // Coupe sur tirets cadratins, virgules avec espaces, parenthèses
  let title = chosen.split(/[–—]|(?:\s+-\s+)|(?:\s+\()/)[0].trim();

  // Retire les ", X m²" (mais garde X pièces qui est informatif)
  title = title.replace(/\s*[,]\s*[Ee]nviron\s+\d+[\d,. ]*\s*m².*$/i, '').trim();
  title = title.replace(/\s+\d+[\d,. ]*\s*m²\s*.*$/i, '').trim();

  // Si MAJUSCULES → Capitaliser
  if (title === title.toUpperCase() && title.length > 4) {
    title = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  }

  // Nettoie mots vides en fin de titre (de, du, à, en, dans, sur, pour, le, la, les)
  title = title.replace(/\s+(de|du|à|en|dans|sur|pour|le|la|les|un|une|des|au)\s*$/i, '').trim();

  // Limite la longueur
  if (title.length > 45) title = title.slice(0, 42) + '...';

  if (!title || title.length < 4) return fallback;
  return title;
}

// Nettoie la description : retire uniquement les coordonnées de signature à la fin
// (sans toucher au corps du texte qui mentionne Charles Morel au début ou au milieu)
function cleanDesc(desc) {
  if (!desc) return '';
  let lines = desc.split('\n');

  // Retire les lignes de pied de page (signature, contact) en partant de la fin
  const FOOTER = [
    /^\s*charles\s+morel\s*[-–]\s*3g\s*immo\s*$/i,
    /^\s*[📞📧☎✉📱]\s*charles\s+morel/i,
    /^\s*[📞📧☎✉📱]\s*06[\s.]*38[\s.]*55[\s.]*53[\s.]*55/i,
    /^\s*[📞📧☎✉📱]\s*charles\.morel/i,
    /^\s*06[\s.]*38[\s.]*55[\s.]*53[\s.]*55\s*$/i,
    /^\s*charles\.morel@3gimmobilier\.com\s*$/i,
    /^\s*contactez[- ]moi\s+pour\s+plus\s+d['']informations\s*[:.]?\s*$/i,
    /^\s*pour\s+plus\s+d['']informations.*contactez/i,
    /^\s*pour\s+toute\s+information.*contact/i,
    /^\s*[📞📧☎✉📱]+\s*$/,
    /^\s*$/,
  ];

  // Coupe à partir de la dernière "section signature" trouvée
  let stop = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (FOOTER.some(re => re.test(line))) {
      stop = i;
      continue;
    }
    // Si la ligne contient "Charles Morel – 3G IMMO" comme bloc isolé en fin
    if (i >= lines.length - 5 && /charles\s+morel.*3g\s*immo/i.test(line) && line.length < 80) {
      stop = i;
      continue;
    }
    break;
  }
  lines = lines.slice(0, stop);

  // Nettoyage final : retire lignes vides en queue
  while (lines.length > 0 && /^\s*$/.test(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join('\n').trim();
}

/* ─────────── Main ─────────── */

async function main() {
  console.log('📡 Appel API 3G IMMO...');
  const res = await fetch(API_URL, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`❌ Erreur API ${res.status}: ${txt.slice(0, 300)}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!data.success) {
    console.error('❌ API success=false:', JSON.stringify(data).slice(0, 300));
    process.exit(1);
  }
  console.log(`✅ ${data.count} annonces reçues (user_id=${data.user_id})`);

  const actives = (data.annonces || []).filter(a => Number(a.e) === 1 || a.e === undefined);

  const properties = actives.map(a => {
    const desc = a.description_annonce || '';
    const typeKey = TYPE_MAP[String(a.type)] || 'maison';
    const photos = gallery(a);
    const cleaned = cleanDesc(desc);
    return {
      id: toInt(a.i),
      type: typeKey,
      title: extractTitle(desc, typeKey, a.sous_type),
      city: extractCity(desc),
      price: toInt(a.prix),
      rooms: toInt(a.nb_pieces),
      bedrooms: toInt(a.nb_chambres),
      surface: toInt(a.surface_bien || a.surface_local || a.surface_utile),
      land: toInt(a.surface_terrain),
      badge: detectBadge(desc, a.etat_pre_archivage),
      img: photos[0] || '',
      gallery: photos.slice(1, 10),
      desc: cleaned,
      ref: a.num_mandat || '',
      year: toInt(a.annee_construction) || null,
    };
  });

  // Tri : Exclusivité > Offre/Compromis > autres ; prix décroissant
  properties.sort((a, b) => {
    const rank = b => b.badge === 'Exclusivité' ? 0 : (b.badge ? 1 : 2);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (b.price || 0) - (a.price || 0);
  });

  const payload = {
    source: '3G IMMO API v1',
    fetched_at: new Date().toISOString(),
    count: properties.length,
    properties,
  };

  const outPath = path.join(__dirname, '..', 'data', 'biens.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`✅ ${properties.length} biens écrits dans data/biens.json`);

  // Récap pour debug
  const noCity = properties.filter(p => !p.city);
  if (noCity.length > 0) {
    console.warn(`⚠️  ${noCity.length} biens sans ville détectée :`);
    noCity.forEach(p => console.warn(`   - id=${p.id} ref=${p.ref} → "${p.title}"`));
  }
}

main().catch(err => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
