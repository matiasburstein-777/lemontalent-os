import crypto from "node:crypto";
import { mapArea, mapSeniority, mapSource, keyCatalogo } from "../shared/profile-options.js";

const AREA_GROUP = "areaSeniority";
const GROUPS = [AREA_GROUP, "fuente", "etiquetas", "basura", "relacion"];
const addNote = (current, line) => {
  const old = String(current || "").trim();
  return old.includes(line) ? old : [old, line].filter(Boolean).join("\n");
};
const fechaISO = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
const esBasuraImportada = (c) => {
  if (fechaISO(c.creado) !== "2026-10-05") return false;
  const k = keyCatalogo(c.nombre);
  const raw = String(c.nombre || "").trim();
  const oneWordLabel = raw.split(/\s+/).length === 1 && (!!mapArea(raw) || !!mapSeniority(raw).value);
  const oldSheetNote = /^(reapertura|postulados?\s+ub|ia\s*[-–—:]|pipeline\s*:|pool\s+lemonx)/i.test(raw);
  const dateLike = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(raw) || /^\d{6,10}$/.test(k);
  return ["c1308","c1277","c1283","c2557"].includes(c.id)
    || /^(ssr|sr|jr|trainee|reapertura|postuladosub|ia|pipeline|poollemonx)/.test(k)
    || oneWordLabel || oldSheetNote || dateLike;
};
const parsePipelineTag = (tag) => {
  const m = /^pipeline\s*:\s*(.+?)\s*[–—-]\s*(.+)$/i.exec(String(tag || "").trim());
  return m ? { cliente: keyCatalogo(m[1]), puesto: keyCatalogo(m[2]) } : null;
};

async function crearPlan(pool) {
  const [{ rows: cs }, { rows: ps }, { rows: bs }] = await Promise.all([
    pool.query("SELECT * FROM candidatos ORDER BY nombre"),
    pool.query("SELECT id,candidato_id,busqueda_id,etapa FROM postulaciones"),
    pool.query("SELECT id,cliente,puesto FROM busquedas"),
  ]);
  const postsByCand = new Map();
  for (const p of ps) postsByCand.set(p.candidato_id, [...(postsByCand.get(p.candidato_id) || []), p]);
  const busqById = new Map(bs.map((b) => [b.id, b]));
  const groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
  const manuales = [];

  for (const c of cs) {
    const posts = postsByCand.get(c.id) || [];
    const a = {};
    let note = c.notas || "";
    if (c.area) {
      const mapped = mapArea(c.area);
      if (mapped !== c.area) {
        a.area = mapped;
        if (!mapped || keyCatalogo(mapped) !== keyCatalogo(c.area)) note = addNote(note, `Área original: ${c.area}`);
      }
    }
    if (c.seniority) {
      const mapped = mapSeniority(c.seniority);
      if (mapped.value !== c.seniority) {
        a.seniority = mapped.value;
        if (mapped.extra) note = addNote(note, `Detalle de seniority: ${mapped.extra}`);
        if (!mapped.value) note = addNote(note, `Seniority original: ${c.seniority}`);
      }
    }
    if (note !== (c.notas || "")) a.notas = note;
    if (Object.keys(a).length) groups[AREA_GROUP].push({ id:c.id,nombre:c.nombre,actual:{area:c.area,seniority:c.seniority,notas:c.notas},nuevo:a });

    const source = mapSource(c.fuente);
    if (source && source !== c.fuente) groups.fuente.push({ id:c.id,nombre:c.nombre,actual:c.fuente,nuevo:source });

    const nextTags = [], removals = [], missingPipeline = [];
    let nextSource = null;
    for (const tag of Array.isArray(c.tags) ? c.tags : []) {
      const t = String(tag);
      if (/^postul[oó]\s*:/i.test(t)) { removals.push(t); nextSource = "Postulación"; continue; }
      if (/pool\s*lemonx/i.test(t)) { removals.push(t); nextSource = "Pool Lemonx"; continue; }
      const pipeline = parsePipelineTag(t);
      if (pipeline) {
        const matching = posts.some((p) => {
          const b = busqById.get(p.busqueda_id);
          return b && keyCatalogo(b.cliente) === pipeline.cliente && keyCatalogo(b.puesto) === pipeline.puesto;
        });
        if (matching) removals.push(t);
        else { nextTags.push(t); missingPipeline.push(t); }
        continue;
      }
      nextTags.push(t);
    }
    if (removals.length || missingPipeline.length) groups.etiquetas.push({
      id:c.id,nombre:c.nombre,actual:{tags:c.tags||[],fuente:c.fuente},
      nuevo:{tags:nextTags,...(nextSource && c.fuente !== nextSource ? {fuente:nextSource} : {})},
      etiquetasSinPostulacion:missingPipeline,
    });

    const garbage = esBasuraImportada(c);
    if (garbage) {
      if (posts.length) manuales.push({ id:c.id,nombre:c.nombre,postulaciones:posts.length });
      else groups.basura.push({ id:c.id,nombre:c.nombre,actual:c.nombre,nuevo:"Eliminar (sin postulaciones)" });
    }

    const rank = (e) => ({ "Sourcing":0,"Contactado":1,"Entrevista LT":2,"Presentado":3,"Entrevista cliente":4,"Ejercicio técnico":5,"Oferta":6,"Contratado":7 }[e] ?? -1);
    const best = Math.max(-1, ...posts.map((p) => rank(p.etapa)));
    const relation = best >= 2 ? "Entrevistado LT" : best === 1 ? "Contactado" : null;
    if ((c.estado_relacion || null) !== relation) groups.relacion.push({ id:c.id,nombre:c.nombre,actual:c.estado_relacion,nuevo:relation });
  }
  return { groups, manuales };
}

export function registerNormalizarBase(app, { pool, auth }) {
  app.post("/api/admin/normalizar-base/preview", auth("admin"), async (_req,res,next) => {
    try { res.json(await crearPlan(pool)); } catch (e) { next(e); }
  });
  app.get("/api/admin/normalizar-base/backup", auth("admin"), async (_req,res,next) => {
    try {
      const { rows } = await pool.query("SELECT value FROM config WHERE key LIKE 'normalizarBaseBackup:%' ORDER BY key DESC LIMIT 1");
      if (!rows[0]) return res.status(404).json({ error:"Todavía no hay un respaldo de normalización." });
      res.setHeader("Content-Type","application/json; charset=utf-8");
      res.setHeader("Content-Disposition",'attachment; filename="candidatos-backup.json"');
      res.send(JSON.stringify(rows[0].value,null,2));
    } catch (e) { next(e); }
  });
  app.post("/api/admin/normalizar-base/apply", auth("admin"), async (req,res,next) => {
    const selected = [...new Set(Array.isArray(req.body?.grupos) ? req.body.grupos : [])];
    if (selected.some((g) => !GROUPS.includes(g))) return res.status(400).json({ error:"Grupo de normalización inválido." });
    try {
      const client = await pool.connect();
      try {
        const { rows } = await client.query("SELECT * FROM candidatos ORDER BY id");
        const generado=new Date().toISOString();
        const backup = { generado, tabla:"candidatos", total:rows.length, registros:rows };
        await client.query("INSERT INTO config(key,value) VALUES($1,$2::jsonb)",[`normalizarBaseBackup:${generado}`,JSON.stringify(backup)]);
      } finally { client.release(); }
      const plan = await crearPlan(pool);
      const counts = {};
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        for (const group of selected) {
          counts[group]=0;
          for (const item of plan.groups[group]) {
            if (group === "basura") {
              const found=await tx.query("SELECT c.* FROM candidatos c WHERE c.id=$1 AND NOT EXISTS (SELECT 1 FROM postulaciones p WHERE p.candidato_id=c.id) FOR UPDATE",[item.id]);
              if(found.rows[0]){
                await tx.query("INSERT INTO papelera(id,usuario_id,coleccion,registro_id,datos) VALUES($1,$2,'candidatos',$3,$4::jsonb)",["pp"+crypto.randomUUID().replace(/-/g,""),req.user.id,item.id,JSON.stringify(found.rows[0])]);
                await tx.query("DELETE FROM candidatos WHERE id=$1",[item.id]);
                await tx.query("INSERT INTO historial(usuario_id,coleccion,registro_id,accion,cambios) VALUES($1,'candidatos',$2,'borrar','{}'::jsonb)",[req.user.id,item.id]);
                counts[group]++;
              }
              continue;
            }
            const patch = group === AREA_GROUP ? item.nuevo : group === "fuente" ? {fuente:item.nuevo} : group === "etiquetas" ? item.nuevo : {estadoRelacion:item.nuevo};
            if(group==="etiquetas"&&JSON.stringify(item.actual.tags||[])===JSON.stringify(patch.tags||[])&&item.actual.fuente===(patch.fuente??item.actual.fuente)) continue;
            const keys = Object.keys(patch);
            if (!keys.length) continue;
            const sets = keys.map((k,i)=>`"${({area:"area",seniority:"seniority",notas:"notas",fuente:"fuente",tags:"tags",estadoRelacion:"estado_relacion"})[k]}"=$${i+1}`).join(",");
            const params = keys.map((k)=>k==="tags"?JSON.stringify(patch[k]):patch[k]);
            params.push(item.id);
            await tx.query(`UPDATE candidatos SET ${sets} WHERE id=$${params.length}`,params);
            counts[group]++;
          }
        }
        await tx.query("COMMIT");
      } catch (e) { await tx.query("ROLLBACK"); throw e; }
      finally { tx.release(); }
      res.json({ ok:true, backupDisponible:true, counts, manuales:plan.manuales, etiquetasPipelineSinPostulacion:plan.groups.etiquetas.flatMap((x)=>x.etiquetasSinPostulacion.map((tag)=>({candidato:x.nombre,tag}))) });
    } catch (e) { next(e); }
  });
}
