#!/usr/bin/env node
/* ============================================================================
   📡 fetch-biens.js
   Récupère TOUTES les infos des annonces depuis l'API 3G IMMO
   + DPE/GES depuis la page publique 3gimmo.com (non exposés par l'API).
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
const PUBLIC_URL = (i, agent) => `https://3gimmo.com/annonce/${i}?agent=${agent}`;

/* ─────────── Mappings 3G IMMO → libellés humains ─────────── */

const TYPE_MAP = {
  '1': 'maison', '2': 'appartement', '3': 'immeuble',
  '4': 'local', '5': 'terrain', '6': 'maison',
};

const SOUS_TYPE_LABEL = {
  '5': 'Maison ancienne', '18': 'Maison de ville', '25': 'Maison de bourg',
  '47': 'Terrain', '61': 'Maison de plain-pied', '64': 'Maison familiale',
  '71': 'Longère',
};

const ETAT_LABEL = {
  '1': 'Sans travaux', '2': 'Avec travaux', '3': 'À rafraîchir',
  '4': 'À rénover', '5': 'Refait à neuf', '6': 'Neuf',
  '7': 'En état futur d\'achèvement',
};

const CHAUFFAGE_LABEL = {
  '1': 'Sans', '2': 'Bois', '3': 'Électrique', '4': 'Fuel',
  '5': 'Gaz', '6': 'Granulés', '7': 'Climatisation réversible',
  '8': 'Pompe à chaleur', '9': 'Solaire', '10': 'Collectif',
  '11': 'Chauffage au sol',
};

const HUISSERIES_LABEL = {
  '1': 'Bois', '2': 'PVC', '3': 'Alu',
  '4': 'Alu et Bois', '5': 'Alu et PVC',
  '6': 'Bois et PVC', '7': 'Alu, Bois et PVC',
};

const EXPOSITION_LABEL = {
  '1': 'Nord', '2': 'Sud', '3': 'Ouest', '4': 'Est',
  '13': 'Nord-Ouest', '14': 'Nord-Est',
  '23': 'Sud-Ouest', '24': 'Sud-Est',
};

const TYPE_TERRAIN_LABEL = {
  '1': 'Aucun', '2': 'Courette', '3': 'Cour', '4': 'Jardin',
  '5': 'Terrain', '6': 'Grand terrain', '7': 'Terrain constructible',
};

const INCLINAISON_LABEL = {
  '1': 'Terrain plat', '2': 'Terrain en pente',
};

const HONORAIRES_LABEL = {
  '1': 'Vendeur', '2': 'Acquéreur',
};

/* ─────────── Communes (bornes mot accent-safe) ─────────── */

const LETTER = "[a-zA-ZéèêëàâäôöûüîïçÉÈÊËÀÂÄÔÖÛÜÎÏÇ]";
const rx = (p) => new RegExp(`(?<!${LETTER})(?:${p})(?!${LETTER})`, 'i');

const COMMUNES = [
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

function toFloat(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function gallery(a) {
  const photos = [];
  for (let i = 1; i <= 20; i++) {
    const url = a[`photo${i}`];
    if (url && typeof url === 'string' && url.trim()) photos.push(url.trim());
  }
  return photos;
}

function extractCity(desc) {
  if (!desc) return '';
  const PROXIMITY = [
    /\b(?:à|a)\s+\d+\s*(?:min|minutes?|km|kilom[èe]tres?)\s+(?:de|du)\s+(?:la\s+(?:gare|ville|sortie|commune))?\s*$/i,
    /\b(?:proche|près|pr[èe]s)\s+(?:de|du|des)\s*$/i,
    /\b(?:gare|gare\s+tgv)\s+(?:de\s+)?$/i,
    /\bautoroute\s+[^\s]*\s*$/i,
    /\bsortie\s+(?:de\s+)?$/i,
  ];
  const matches = [];
  for (const c of COMMUNES) {
    let m;
    const re = new RegExp(c.re.source, 'gi');
    while ((m = re.exec(desc)) !== null) {
      const before = desc.slice(Math.max(0, m.index - 50), m.index);
      const isProx = PROXIMITY.some(p => p.test(before));
      matches.push({ commune: c, pos: m.index, isProx });
    }
  }
  if (!matches.length) return '';
  const nonProx = matches.filter(m => !m.isProx).sort((a, b) => a.pos - b.pos);
  const winner = nonProx[0] || matches.sort((a, b) => a.pos - b.pos)[0];
  return `${winner.commune.name} (${winner.commune.cp})`;
}

function detectBadge(desc, etat_pre_archivage) {
  if (!desc) desc = '';
  const lower = desc.toLowerCase();
  if (Number(etat_pre_archivage) === 2 || /sous\s+compromis/.test(lower)) return 'Sous compromis';
  if (Number(etat_pre_archivage) === 3 || /offre\s+en\s+cours/.test(lower)) return 'Offre en cours';
  if (/baisse\s+de\s+prix/.test(lower)) return 'Baisse de prix';
  if (/(en\s+)?exclusivit[ée]/.test(lower)) return 'Exclusivité';
  return null;
}

function extractTitle(desc, type, sous_type) {
  const fallback = type === 'terrain' ? 'Terrain' :
                   SOUS_TYPE_LABEL[String(sous_type)] || 'Maison';
  if (!desc) return fallback;
  const lines = desc.split('\n').map(s => s.trim()).filter(Boolean);
  const SKIP = /^(charles\s+morel|📞|📧|☎|✉|coup\s+de\s+c[œo]ur|caract[ée]ristiques|informations\s+compl|au\s+(?:rez|premier|deuxi|sous-sol|étage)|à\s+l['']int[ée]rieur|à\s+l['']ext[ée]rieur|confort\s*:|extérieur|intérieur|prix\s*:|dpe\s|honoraires|les?\s+plus|atouts|[-*•·]\s|une\s+entr[ée]e|surface\s+habitable|nombre\s+de\s+pi[èe]ces|chauffage\s*:|nombre\s+de\s+chambres|menuiseries\s*:|ventilation\s*:|ballon\s+d|cuisine\s+|s[ée]jour|salon|toiture\s*:|fa[çc]ade\s*:|isolation\s*:|au\s+sol|ann[ée]e\s+de|huisseries\s*:|assainissement\s*:|exposition\s*:|orientation\s*:|terrain\s*:|jardin\s*:|.*\s*:\s*$)/i;
  let chosen = '';
  for (const l of lines) {
    if (SKIP.test(l)) continue;
    if (l.length < 4) continue;
    chosen = l;
    break;
  }
  if (!chosen) return fallback;
  let title = chosen.split(/[–—]|(?:\s+-\s+)|(?:\s+\()/)[0].trim();
  title = title.replace(/\s*[,]\s*[Ee]nviron\s+\d+[\d,. ]*\s*m².*$/i, '').trim();
  title = title.replace(/\s+\d+[\d,. ]*\s*m²\s*.*$/i, '').trim();
  if (title === title.toUpperCase() && title.length > 4) {
    title = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  }
  title = title.replace(/\s+(de|du|à|en|dans|sur|pour|le|la|les|un|une|des|au)\s*$/i, '').trim();
  if (title.length > 45) title = title.slice(0, 42) + '...';
  if (!title || title.length < 4) return fallback;
  return title;
}

function cleanDesc(desc) {
  if (!desc) return '';
  let lines = desc.split('\n');
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
  let stop = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FOOTER.some(re => re.test(lines[i]))) { stop = i; continue; }
    if (i >= lines.length - 5 && /charles\s+morel.*3g\s*immo/i.test(lines[i]) && lines[i].length < 80) {
      stop = i; continue;
    }
    break;
  }
  lines = lines.slice(0, stop);
  while (lines.length > 0 && /^\s*$/.test(lines[lines.length - 1])) lines.pop();
  return lines.join('\n').trim();
}

/* ─────────── Scrape DPE/GES depuis la page publique 3gimmo.com ─────────── */
async function scrapeDPE(id, agent) {
  try {
    const res = await fetch(PUBLIC_URL(id, agent), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Charles-Morel-Sync/1.0)' },
    });
    if (!res.ok) return { dpe: '', ges: '' };
    const html = await res.text();
    // Cherche le bloc <div id="dpe_X" class="dpe_line ... DPEselected">
    const dpeMatch = html.match(/id="dpe_([A-G])"\s+class="[^"]*DPEselected/i);
    const gesMatch = html.match(/id="ges_([A-G])"\s+class="[^"]*GESselected/i);
    return {
      dpe: dpeMatch ? dpeMatch[1] : '',
      ges: gesMatch ? gesMatch[1] : '',
    };
  } catch (e) {
    return { dpe: '', ges: '' };
  }
}

/* ─────────── Main ─────────── */

async function main() {
  console.log('📡 Appel API 3G IMMO...');
  const res = await fetch(API_URL, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    console.error(`❌ Erreur API ${res.status}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!data.success) { console.error('❌ success=false'); process.exit(1); }
  console.log(`✅ ${data.count} annonces (user_id=${data.user_id})`);

  const actives = (data.annonces || []).filter(a => Number(a.e) === 1 || a.e === undefined);

  // Récupérer DPE/GES en parallèle (limite 60 req/min → on est large à 17)
  console.log('🔎 Récupération DPE/GES depuis les pages publiques...');
  const dpeData = await Promise.all(
    actives.map(a => scrapeDPE(a.i, data.user_id).catch(() => ({ dpe: '', ges: '' })))
  );
  const dpeOk = dpeData.filter(d => d.dpe).length;
  console.log(`   → ${dpeOk}/${actives.length} DPE trouvés`);

  const properties = actives.map((a, idx) => {
    const desc = a.description_annonce || '';
    const typeKey = TYPE_MAP[String(a.type)] || 'maison';
    const photos = gallery(a);
    const cleaned = cleanDesc(desc);
    const { dpe, ges } = dpeData[idx];

    return {
      // Identité
      id: toInt(a.i),
      ref: a.num_mandat || '',
      type: typeKey,
      sousType: SOUS_TYPE_LABEL[String(a.sous_type)] || null,
      title: extractTitle(desc, typeKey, a.sous_type),
      city: extractCity(desc),
      badge: detectBadge(desc, a.etat_pre_archivage),

      // Description + photos
      desc: cleaned,
      img: photos[0] || '',
      gallery: photos.slice(1, 20),

      // Prix & honoraires
      price: toInt(a.prix),
      honoraires: HONORAIRES_LABEL[String(a.honoraire_a_charge)] || null,

      // Surfaces
      surface: toInt(a.surface_bien || a.surface_local || a.surface_utile),
      surfaceUtile: toFloat(a.surface_utile),
      land: toInt(a.surface_terrain),
      typeTerrain: TYPE_TERRAIN_LABEL[String(a.type_terrain)] || null,
      inclinaisonTerrain: INCLINAISON_LABEL[String(a.inclinaison_terrain)] || null,

      // Pièces
      rooms: toInt(a.nb_pieces),
      bedrooms: toInt(a.nb_chambres),
      bathrooms: toInt(a.nb_salle_bain),
      showerRooms: toInt(a.nb_salle_eau),
      wc: toInt(a.nb_wc),
      wcSepare: toInt(a.nb_wc_separe),

      // Parkings / garages
      garages: toInt(a.nb_garages),
      parkings: toInt(a.nb_parkings_interieur),
      balcons: toInt(a.nb_balcons),

      // Caractéristiques bâtiment
      year: toInt(a.annee_construction) || null,
      etat: ETAT_LABEL[String(a.etat)] || null,
      huisseries: HUISSERIES_LABEL[String(a.huisseries)] || null,
      exposition: EXPOSITION_LABEL[String(a.exposition)] || null,

      // Chauffage
      heating: CHAUFFAGE_LABEL[String(a.type_chauffage_principal)] || null,
      heatingSecondary: CHAUFFAGE_LABEL[String(a.type_chauffage_secondaire)] || null,

      // Charges
      taxeFonciere: toInt(a.taxe_fonciere),

      // DPE / GES (scrapés)
      dpe,
      ges,

      // Lien public 3G IMMO
      publicUrl: PUBLIC_URL(a.i, data.user_id),
    };
  });

  // Tri : Exclusivité > avec badge > sans ; prix décroissant
  properties.sort((a, b) => {
    const rank = x => x.badge === 'Exclusivité' ? 0 : (x.badge ? 1 : 2);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (b.price || 0) - (a.price || 0);
  });

  const payload = {
    source: '3G IMMO API v1 + DPE 3gimmo.com',
    fetched_at: new Date().toISOString(),
    count: properties.length,
    properties,
  };

  const outPath = path.join(__dirname, '..', 'data', 'biens.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`✅ ${properties.length} biens écrits dans data/biens.json`);

  const noCity = properties.filter(p => !p.city);
  if (noCity.length > 0) {
    console.warn(`⚠️  ${noCity.length} biens sans ville détectée :`);
    noCity.forEach(p => console.warn(`   - id=${p.id} ref=${p.ref} → "${p.title}"`));
  }
}

main().catch(err => { console.error('❌', err); process.exit(1); });
