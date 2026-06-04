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

// Type de bien (clé API "type") → catégorie utilisée par le site
const TYPE_MAP = {
  '1': { key: 'maison', label: 'Maison' },
  '2': { key: 'appartement', label: 'Appartement' },
  '3': { key: 'terrain', label: 'Terrain' },
  '4': { key: 'immeuble', label: 'Immeuble' },
  '5': { key: 'local', label: 'Local' },
  '6': { key: 'maison', label: 'Maison de village' },
  '7': { key: 'maison', label: 'Longère' },
  '8': { key: 'maison', label: 'Propriété' },
  '9': { key: 'maison', label: 'Château' },
};

// Sous-type → libellé éditorial pour le title (si présent)
const SOUS_TYPE_LABELS = {
  // À étoffer au fur et à mesure des biens rencontrés
};

/* ─────────── Helpers ─────────── */

function mapType(apiType, sousType) {
  const t = TYPE_MAP[String(apiType)] || { key: 'maison', label: 'Bien' };
  return t.key;
}

function buildTitle(annonce) {
  // Préfère sous_type s'il existe, sinon type principal
  const sous = SOUS_TYPE_LABELS[String(annonce.sous_type)];
  if (sous) return sous;
  const t = TYPE_MAP[String(annonce.type)];
  if (t) return t.label;
  return 'Bien immobilier';
}

function buildCity(annonce) {
  const ville = (annonce.ville_diffusion || annonce.ville_bien || '').trim();
  // Chercher un code postal si présent
  const cp = annonce.code_postal_diffusion || annonce.code_postal_bien || annonce.cp || '';
  if (!ville) return '';
  if (cp) return `${ville} (${cp})`;
  return ville;
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

function deriveBadge(annonce) {
  // 3G IMMO n'a pas de "badge" explicite. On regarde quelques indicateurs.
  if (annonce.vente_interactive === 1 || annonce.vente_interactive === '1') return 'Vente interactive';
  // etat_pre_archivage peut signaler compromis/offre, à affiner si besoin
  if (annonce.etat_pre_archivage === 2) return 'Sous compromis';
  if (annonce.etat_pre_archivage === 3) return 'Offre en cours';
  return null;
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(String(v).replace(/[^\d.-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/* ─────────── Main ─────────── */

async function main() {
  console.log('📡 Appel de l\'API 3G IMMO...');
  const res = await fetch(API_URL, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`❌ Erreur API ${res.status} ${res.statusText}: ${txt.slice(0, 500)}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!data.success) {
    console.error('❌ API a renvoyé success=false:', JSON.stringify(data).slice(0, 500));
    process.exit(1);
  }
  console.log(`✅ ${data.count} annonces récupérées (user_id=${data.user_id})`);

  // Filtrer les annonces actives (e=1) au cas où l'API en renvoie d'autres
  const actives = (data.annonces || []).filter(a => Number(a.e) === 1 || a.e === undefined);

  const properties = actives.map(a => {
    const photos = gallery(a);
    return {
      id: toInt(a.i),
      type: mapType(a.type, a.sous_type),
      title: buildTitle(a),
      city: buildCity(a),
      price: toInt(a.prix),
      rooms: toInt(a.nb_pieces),
      bedrooms: toInt(a.nb_chambres),
      surface: toInt(a.surface_bien || a.surface_local || a.surface_utile),
      land: toInt(a.surface_terrain),
      badge: deriveBadge(a),
      img: photos[0] || '',
      gallery: photos.slice(1, 10),
      desc: (a.description_annonce || '').trim(),
      ref: a.num_mandat || '',
      dpe: a.dpe_note_energie || '',
      year: toInt(a.annee_construction) || null,
      energy: a.type_chauffage_principal || '',
    };
  });

  // Tri : exclusivités en premier puis prix décroissant
  properties.sort((a, b) => {
    const pa = a.badge === 'Exclusivité' ? 0 : 1;
    const pb = b.badge === 'Exclusivité' ? 0 : 1;
    if (pa !== pb) return pa - pb;
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
}

main().catch(err => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
